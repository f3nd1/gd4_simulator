import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { extractPptxText } from "../textUtils";

// Minimal DrawingML slide part with the given <a:t> runs (title/body/table
// cells all use a:t, so this mirrors a real slide closely enough).
function slideXml(runs: string[]): string {
  const paras = runs.map((r) => `<a:p><a:r><a:t>${r}</a:t></a:r></a:p>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${paras}</p:spTree></p:cSld></p:sld>`;
}
function notesXml(text: string): string {
  return `<?xml version="1.0"?><p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:notes>`;
}
async function buildPptx(parts: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(parts)) zip.file(name, content);
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("extractPptxText", () => {
  it("extracts slide titles, body, table cells and speaker notes", async () => {
    const buf = await buildPptx({
      "ppt/slides/slide1.xml": slideXml(["Student Satisfaction Survey", "Overall 4.2 / 5", "Q1", "85%"]),
      "ppt/notesSlides/notesSlide1.xml": notesXml("Shared with students via bulletin"),
    });
    const out = await extractPptxText(buf, "SS with students (via bulletin).pptx");
    expect(out).toContain("File: SS with students (via bulletin).pptx");
    expect(out).toContain("Student Satisfaction Survey");
    expect(out).toContain("Overall 4.2 / 5");
    expect(out).toContain("85%"); // table cell text
    expect(out).toContain("[Speaker notes] Shared with students via bulletin");
    expect(out).toContain("--- Slide 1 ---");
  });

  it("preserves slide order numerically (slide2 before slide10)", async () => {
    const buf = await buildPptx({
      "ppt/slides/slide1.xml": slideXml(["First"]),
      "ppt/slides/slide2.xml": slideXml(["Second"]),
      "ppt/slides/slide10.xml": slideXml(["Tenth"]),
    });
    const out = await extractPptxText(buf, "deck.pptx");
    expect(out.indexOf("Second")).toBeLessThan(out.indexOf("Tenth"));
    expect(out.indexOf("First")).toBeLessThan(out.indexOf("Second"));
    expect(out).toContain("--- Slide 10 ---");
  });

  it("decodes XML entities in run text", async () => {
    const buf = await buildPptx({ "ppt/slides/slide1.xml": slideXml(["Fees &amp; refunds &lt;policy&gt;"]) });
    const out = await extractPptxText(buf, "x.pptx");
    expect(out).toContain("Fees & refunds <policy>");
  });

  it("returns empty string for an image-only deck (no <a:t> text)", async () => {
    // A slide part with a picture but no text runs.
    const imgSlide = `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`;
    const buf = await buildPptx({ "ppt/slides/slide1.xml": imgSlide });
    const out = await extractPptxText(buf, "scan.pptx");
    expect(out).toBe("");
  });

  it("returns empty string for a deck with no slides at all", async () => {
    const buf = await buildPptx({ "docProps/core.xml": "<x/>" });
    expect(await extractPptxText(buf, "empty.pptx")).toBe("");
  });
});
