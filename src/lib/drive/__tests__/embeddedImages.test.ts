import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  extractPptxEmbeddedImages,
  extractDocxEmbeddedImages,
  extractXlsxEmbeddedImages,
  type EmbeddedImageRef,
} from "../textUtils";

// A 1x1 PNG's worth of bytes is irrelevant to the extractor (it only base64s
// whatever is in the media part), so any bytes stand in for "an image".
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function slidePic(): string {
  return `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`;
}
function slideRels(target: string): string {
  return `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/></Relationships>`;
}
async function zipToBuffer(parts: Record<string, string | Uint8Array>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(parts)) zip.file(name, content);
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("extractPptxEmbeddedImages", () => {
  it("associates an embedded image with its slide via rels and returns a data URL", async () => {
    const buf = await zipToBuffer({
      "ppt/slides/slide1.xml": slidePic(),
      "ppt/slides/_rels/slide1.xml.rels": slideRels("../media/image1.png"),
      "ppt/media/image1.png": PNG_BYTES,
    });
    const refs = await extractPptxEmbeddedImages(buf);
    expect(refs).toHaveLength(1);
    expect(refs[0].location).toBe("Slide 1");
    expect(refs[0].supported).toBe(true);
    expect(refs[0].dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("labels images by slide number for multi-slide decks", async () => {
    const buf = await zipToBuffer({
      "ppt/slides/slide1.xml": slidePic(),
      "ppt/slides/_rels/slide1.xml.rels": slideRels("../media/image1.png"),
      "ppt/slides/slide2.xml": slidePic(),
      "ppt/slides/_rels/slide2.xml.rels": slideRels("../media/image2.jpeg"),
      "ppt/media/image1.png": PNG_BYTES,
      "ppt/media/image2.jpeg": PNG_BYTES,
    });
    const refs = await extractPptxEmbeddedImages(buf);
    expect(refs.map((r) => r.location)).toEqual(["Slide 1", "Slide 2"]);
    expect(refs[1].dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("flags an unsupported vector format (emf) rather than returning a data URL", async () => {
    const buf = await zipToBuffer({
      "ppt/slides/slide1.xml": slidePic(),
      "ppt/slides/_rels/slide1.xml.rels": slideRels("../media/image1.emf"),
      "ppt/media/image1.emf": PNG_BYTES,
    });
    const refs = await extractPptxEmbeddedImages(buf);
    expect(refs).toHaveLength(1);
    expect(refs[0].supported).toBe(false);
    expect(refs[0].dataUrl).toBeNull();
  });

  it("dedupes an image referenced by more than one slide", async () => {
    const buf = await zipToBuffer({
      "ppt/slides/slide1.xml": slidePic(),
      "ppt/slides/_rels/slide1.xml.rels": slideRels("../media/image1.png"),
      "ppt/slides/slide2.xml": slidePic(),
      "ppt/slides/_rels/slide2.xml.rels": slideRels("../media/image1.png"),
      "ppt/media/image1.png": PNG_BYTES,
    });
    const refs = await extractPptxEmbeddedImages(buf);
    expect(refs).toHaveLength(1);
    expect(refs[0].location).toBe("Slide 1");
  });

  it("falls back to enumerating ppt/media when no slide rels resolve", async () => {
    const buf = await zipToBuffer({
      "ppt/slides/slide1.xml": slidePic(), // no rels file
      "ppt/media/image1.png": PNG_BYTES,
    });
    const refs = await extractPptxEmbeddedImages(buf);
    expect(refs).toHaveLength(1);
    expect(refs[0].location).toBe("Embedded image 1");
  });

  it("returns nothing for a deck with no media", async () => {
    const buf = await zipToBuffer({ "ppt/slides/slide1.xml": "<p:sld/>" });
    expect(await extractPptxEmbeddedImages(buf)).toEqual([]);
  });
});

describe("extractDocxEmbeddedImages / extractXlsxEmbeddedImages", () => {
  it("enumerates images in word/media in numeric order", async () => {
    const buf = await zipToBuffer({
      "word/document.xml": "<w/>",
      "word/media/image2.png": PNG_BYTES,
      "word/media/image10.png": PNG_BYTES,
      "word/media/image1.png": PNG_BYTES,
    });
    const refs = await extractDocxEmbeddedImages(buf);
    expect(refs.map((r) => r.location)).toEqual(["Embedded image 1", "Embedded image 2", "Embedded image 3"]);
    // image1 sorts before image2 before image10 (numeric, not lexical)
    expect(refs.every((r: EmbeddedImageRef) => r.supported)).toBe(true);
  });

  it("enumerates images in xl/media", async () => {
    const buf = await zipToBuffer({
      "xl/workbook.xml": "<w/>",
      "xl/media/image1.gif": PNG_BYTES,
    });
    const refs = await extractXlsxEmbeddedImages(buf);
    expect(refs).toHaveLength(1);
    expect(refs[0].dataUrl).toMatch(/^data:image\/gif;base64,/);
  });

  it("returns nothing when there is no media folder", async () => {
    const buf = await zipToBuffer({ "word/document.xml": "<w/>" });
    expect(await extractDocxEmbeddedImages(buf)).toEqual([]);
  });
});
