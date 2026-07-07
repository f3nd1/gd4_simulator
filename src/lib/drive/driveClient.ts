// Thin wrapper around Google's browser-only OAuth (Google Identity Services
// "token client") and the Drive v3 REST API. This is the ONLY place that
// knows how to reach Google Drive — every other module gets a folder's
// files/text through the functions below, never by talking to Google
// directly. Mirrors the same "one client module, prototype-only" pattern
// used for OpenAI in aiClient.ts: the access token lives in memory only
// (never persisted), is requested directly from the browser, and there is
// no backend proxy.

// pdfCompat MUST load before pdfjs: it polyfills the ReadableStream async
// iterator / Promise.withResolvers that pdfjs v6 needs and Safari lacks.
import "./pdfCompat";
// The /legacy build is Babel-transpiled for older engines. We drive it
// through our OWN worker wrapper (pdfWorker.ts, loaded as a Vite ?worker)
// rather than pointing workerSrc at the raw pdfjs worker file — the wrapper
// installs the same polyfills inside the worker's separate global scope,
// which is where the PDF parsing (and the ReadableStream use that throws on
// Safari) actually runs. A plain workerSrc URL can't inject that.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import PdfjsWorker from "./pdfWorker?worker";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
// Import pure text utilities for use within this module, and re-export so
// callers don't need to import from textUtils directly.
import {
  extractSpreadsheetText as _extractSpreadsheetText,
  extractPptxText as _extractPptxText,
  extractPptxEmbeddedImages,
  extractDocxEmbeddedImages,
  extractXlsxEmbeddedImages,
  type EmbeddedImageRef,
} from "./textUtils";
export { classifyPdfTextQuality, extractSpreadsheetText, extractPptxText } from "./textUtils";
const extractSpreadsheetText = _extractSpreadsheetText;
const extractPptxText = _extractPptxText;

// Embedded-image vision hook. Office files (PPTX/DOCX/XLSX) can hide their real
// content inside pasted pictures that the text extractors never see. When a
// caller supplies this hook, exportFileText pulls those pictures out of the
// file and hands the supported (raster) ones here to be transcribed through the
// SAME vision path used for standalone images and scanned PDFs. The hook owns
// the cost controls — it enforces the run's MAX_IMAGES budget and returns how
// many it skipped for the cap so exportFileText can flag them, never silently
// drop them. Typed text is always kept; the transcription is merged, not
// substituted.
export type EmbeddedVisionImage = { location: string; dataUrl: string };
export type EmbeddedVisionResult = {
  transcripts: { location: string; text: string }[];
  skippedForCapCount: number;
};
export type EmbeddedImageHook = (images: EmbeddedVisionImage[]) => Promise<EmbeddedVisionResult>;

// Merge embedded-image transcriptions into a file's typed text. Preserves the
// typed text verbatim, appends per-image transcriptions labelled by location
// (slide number etc.) in order, and appends visible notes for any images that
// could NOT be transcribed (no vision available, cap reached, or an unsupported
// vector format) so a partially-read document never looks fully read.
async function mergeEmbeddedImages(
  refs: EmbeddedImageRef[],
  baseText: string,
  hook: EmbeddedImageHook | undefined,
): Promise<string> {
  if (refs.length === 0) return baseText;

  const supported = refs.filter((r) => r.supported && r.dataUrl);
  const unsupportedCount = refs.length - supported.length;

  let transcripts: { location: string; text: string }[] = [];
  let skippedForCapCount = 0;
  if (hook && supported.length > 0) {
    const res = await hook(supported.map((r) => ({ location: r.location, dataUrl: r.dataUrl! })));
    transcripts = res.transcripts;
    skippedForCapCount = res.skippedForCapCount;
  }

  const sections: string[] = [];
  if (baseText.trim()) sections.push(baseText.trimEnd());
  if (transcripts.length > 0) {
    sections.push("[Embedded images transcribed via vision:]");
    for (const t of transcripts) sections.push(`--- ${t.location} (embedded image) ---\n${t.text}`);
  }

  const notes: string[] = [];
  if (!hook && supported.length > 0) {
    notes.push(`[${supported.length} embedded image(s) present but NOT transcribed — no vision model available (enable AI and add an API key in Settings).]`);
  }
  if (skippedForCapCount > 0) {
    notes.push(`[${skippedForCapCount} embedded image(s) NOT transcribed — the per-run vision budget was reached.]`);
  }
  if (unsupportedCount > 0) {
    notes.push(`[${unsupportedCount} embedded image(s) in an unsupported vector/unknown format were NOT transcribed.]`);
  }
  if (notes.length) sections.push(notes.join("\n"));

  return sections.join("\n\n");
}

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfjsWorker();

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const GSI_SRC = "https://accounts.google.com/gsi/client";

// MIME types for Excel files — exported so useWorkspaceStore can use them
// for the fileKind classifier without duplicating the string literals.
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const XLS_MIME = "application/vnd.ms-excel";
// Modern PowerPoint (.pptx). The old binary .ppt
// (application/vnd.ms-powerpoint) is deliberately NOT handled here — it is an
// OLE/CFB binary with no reliable pure-JS extractor, so it stays unreadable
// until we decide whether to support it.
export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => void;
          }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
        };
      };
    };
  }
}

let gsiLoadPromise: Promise<void> | null = null;

function loadGsiScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gsiLoadPromise) return gsiLoadPromise;
  gsiLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services script."));
    document.head.appendChild(script);
  });
  return gsiLoadPromise;
}

export class DriveAuthError extends Error {}

// Opens Google's consent popup and resolves with an access token scoped to
// drive.readonly. Requires the caller to have a valid OAuth Client ID
// (Web application type, with this app's origin in "Authorized JavaScript
// origins") created in Google Cloud Console — that one-time setup happens
// outside this app, in the user's own Google account.
//
// `silent: true` passes prompt: "none" instead — Google issues a fresh
// token with no UI at all if this origin already has an active, consented
// session, or fails immediately with no popup otherwise. Used to quietly
// re-establish the connection on page load (the access token itself is
// never persisted, so every reload otherwise starts "disconnected" even
// though the user already granted access earlier in the same browser).
export async function requestDriveAccessToken(
  clientId: string,
  opts: { silent?: boolean } = {}
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  if (!clientId) throw new DriveAuthError("No Google OAuth Client ID configured in Settings.");
  await loadGsiScript();
  if (!window.google?.accounts?.oauth2) throw new DriveAuthError("Google Identity Services failed to load.");

  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new DriveAuthError(resp.error || "Google did not return an access token."));
          return;
        }
        resolve({ accessToken: resp.access_token, expiresInSeconds: resp.expires_in || 3600 });
      },
    });
    client.requestAccessToken(opts.silent ? { prompt: "none" } : undefined);
  });
}

// Folder links look like https://drive.google.com/drive/folders/<ID>?... —
// extracts just the ID so the Owner-set folder link field doubles as the
// Drive API target with no separate input needed.
export function parseFolderId(link?: string): string | null {
  if (!link) return null;
  const match = link.match(/\/folders\/([a-zA-Z0-9_-]+)/) || link.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export class DriveApiError extends Error {
  status?: number;
  reason?: string;
}

export type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string };

async function driveFetch(url: string, accessToken: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Google returns structured JSON ({ error: { message, errors: [...] } })
    // — surface its actual reason (e.g. "insufficientFilePermissions" vs.
    // "Drive API has not been used in project ... before or it is disabled")
    // instead of just the HTTP status, since both currently collapse to the
    // same generic "denied access" message at the call site otherwise.
    let reason = text.slice(0, 200);
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error?.message) reason = parsed.error.message;
    } catch {
      // not JSON — keep the raw text snippet
    }
    const err = new DriveApiError(`Drive API request failed (${res.status}): ${reason}`);
    err.status = res.status;
    err.reason = reason;
    throw err;
  }
  return res;
}

// supportsAllDrives + includeItemsFromAllDrives: without these, the v3 API's
// default corpus is "My Drive + shared directly with me" and SILENTLY
// excludes Shared/Team Drive items — a folder living in a Shared Drive then
// looks "denied" (403) or simply not found, even though the connected
// account genuinely has viewer access to it.
export async function listFolderFiles(folderId: string, accessToken: string, signal?: AbortSignal): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const baseUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const all: DriveFile[] = [];
  let pageToken: string | undefined;
  // Guard: cap at 5 pages (500 files) per folder level to prevent runaway
  // loops on very large or looping Shared Drive structures.
  const MAX_PAGES = 5;
  let pages = 0;
  do {
    const url = pageToken ? `${baseUrl}&pageToken=${encodeURIComponent(pageToken)}` : baseUrl;
    const res = await driveFetch(url, accessToken, signal);
    const data = await res.json();
    all.push(...((data.files || []) as DriveFile[]));
    pageToken = data.nextPageToken as string | undefined;
    pages++;
  } while (pageToken && pages < MAX_PAGES);
  return all;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveFileWithPath = DriveFile & { path: string };

// Evidence owners commonly organize a sub-criterion's folder into nested
// subfolders (e.g. "2024/Q1", "Signed copies") — without recursing, anything
// not directly inside the top-level folder silently looked empty to the
// audit. Depth-capped rather than unbounded, since a Shared Drive can
// contain folder shortcuts that would otherwise let this recurse forever.
const MAX_FOLDER_DEPTH = 6;

export async function listFolderFilesRecursive(
  folderId: string,
  accessToken: string,
  path = "",
  depth = 0,
  signal?: AbortSignal
): Promise<DriveFileWithPath[]> {
  if (depth > MAX_FOLDER_DEPTH) return [];
  const entries = await listFolderFiles(folderId, accessToken, signal);
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path ? `${path}/${entry.name}` : entry.name;
      if (entry.mimeType === FOLDER_MIME) return listFolderFilesRecursive(entry.id, accessToken, entryPath, depth + 1, signal);
      return Promise.resolve<DriveFileWithPath[]>([{ ...entry, path: entryPath }]);
    })
  );
  return nested.flat();
}

// Exported MIME types we know how to turn into plain text via Drive's
// /export endpoint. PDF is handled separately below (no /export conversion
// exists for it). Anything else (images, video, etc.) is reported as
// unsupported rather than silently skipped, so the audit can disclose
// exactly what it did and did not read.
const GOOGLE_EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

// PDF has no Drive /export conversion (that's only for Google-native
// formats) — read the raw bytes via alt=media instead and extract text
// client-side, consistent with this app having no backend to do it for us.
// Exported (not just used internally) because it has zero Drive dependency
// itself — src/lib/uploadedDocText.ts reuses it for locally-uploaded PDFs.
export async function extractPdfText(bytes: ArrayBuffer): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return pages.join("\n\n");
  } finally {
    // Free the document in the (shared) worker — without this, auditing a
    // folder of dozens of PDFs would pile them all up in worker memory.
    await loadingTask.destroy();
  }
}

// Renders the first `maxPages` pages of a PDF's raw bytes to PNG data URLs so a
// scanned / image-only PDF (one where extractPdfText found ~no text) can be
// read through the SAME vision path used for standalone images. Browser-only:
// uses a <canvas>, so this must never be imported in Node/Vitest (driveClient
// is already worker-bound and excluded from tests for the same reason).
// Returns the images plus the PDF's true page count so the caller can disclose
// when only the first N of M pages were rendered (page/image budget cap).
const PDF_RENDER_SCALE = 2.0; // ~144 DPI — legible for OCR-style transcription without huge payloads

async function renderPdfBytesToImages(bytes: ArrayBuffer, maxPages: number): Promise<{ images: string[]; totalPages: number }> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  try {
    const totalPages = pdf.numPages;
    const images: string[] = [];
    const n = Math.min(totalPages, Math.max(0, maxPages));
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      try {
        const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        // White backing so transparent (vector) PDFs don't render text on black.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, canvas, viewport }).promise;
        images.push(canvas.toDataURL("image/png"));
      } finally {
        page.cleanup();
      }
    }
    return { images, totalPages };
  } finally {
    await loadingTask.destroy();
  }
}

// Fetches a PDF from Drive and renders up to `maxPages` of its pages to images.
// Used only as a fallback when text extraction genuinely failed — never for a
// normal text PDF.
export async function exportPdfPageImages(file: DriveFile, accessToken: string, maxPages: number, signal?: AbortSignal): Promise<{ images: string[]; totalPages: number }> {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, accessToken, signal);
  return renderPdfBytesToImages(await res.arrayBuffer(), maxPages);
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/tiff"]);

export async function exportFileText(
  file: DriveFile,
  accessToken: string,
  signal?: AbortSignal,
  embeddedImageHook?: EmbeddedImageHook,
): Promise<string | null> {
  if (file.mimeType in GOOGLE_EXPORT_MIME) {
    const mime = encodeURIComponent(GOOGLE_EXPORT_MIME[file.mimeType]);
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${mime}&supportsAllDrives=true`, accessToken, signal);
    return res.text();
  }
  if (file.mimeType === "text/plain" || file.mimeType === "text/csv") {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, accessToken, signal);
    return res.text();
  }
  if (file.mimeType === "application/pdf") {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, accessToken, signal);
    return extractPdfText(await res.arrayBuffer());
  }
  if (file.mimeType === DOCX_MIME) {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, accessToken, signal);
    const buffer = await res.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
    // .docx is an OpenXML zip — pull any embedded pictures (mammoth drops them)
    // and transcribe them through vision, merged with the typed text.
    return mergeEmbeddedImages(await extractDocxEmbeddedImages(buffer), value, embeddedImageHook);
  }
  // Excel/XLSX support — reads raw bytes and extracts structured spreadsheet text
  // so the AI auditor can see column headers, row data, and sheet names rather
  // than a flattened anonymous text blob.
  if (file.mimeType === XLSX_MIME || file.mimeType === XLS_MIME) {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, accessToken, signal);
    const buffer = await res.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const text = extractSpreadsheetText(wb, file.name);
    // Only the modern .xlsx is an OpenXML zip we can unpack for embedded images;
    // the legacy binary .xls is a non-zip OLE container, so skip it there.
    if (file.mimeType === XLSX_MIME) {
      return mergeEmbeddedImages(await extractXlsxEmbeddedImages(buffer), text, embeddedImageHook);
    }
    return text;
  }
  // PowerPoint (.pptx): pull slide/table/text-box text and speaker notes, plus
  // any embedded pictures (screenshots of emails, scans) transcribed via vision
  // and merged in. A deck with neither extractable text nor readable images
  // returns null — honestly flagged unreadable, never passed as blank evidence.
  if (file.mimeType === PPTX_MIME) {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, accessToken, signal);
    const buffer = await res.arrayBuffer();
    const text = await extractPptxText(buffer, file.name);
    const merged = await mergeEmbeddedImages(await extractPptxEmbeddedImages(buffer), text, embeddedImageHook);
    return merged.trim().length > 0 ? merged : null;
  }
  return null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // String.fromCharCode has an argument-count limit per call
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Images have no extractable text of their own — the caller (see
// auditFolderContents in useWorkspaceStore.ts) hands this data: URL to an AI
// vision call instead. Returned as base64 here, where the raw bytes already
// are, rather than making every caller re-fetch and re-encode them.
export async function exportFileImageDataUrl(file: DriveFile, accessToken: string, signal?: AbortSignal): Promise<string> {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, accessToken, signal);
  const base64 = arrayBufferToBase64(await res.arrayBuffer());
  return `data:${file.mimeType};base64,${base64}`;
}
