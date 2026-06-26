// Thin wrapper around Google's browser-only OAuth (Google Identity Services
// "token client") and the Drive v3 REST API. This is the ONLY place that
// knows how to reach Google Drive — every other module gets a folder's
// files/text through the functions below, never by talking to Google
// directly. Mirrors the same "one client module, prototype-only" pattern
// used for OpenAI in aiClient.ts: the access token lives in memory only
// (never persisted), is requested directly from the browser, and there is
// no backend proxy.

import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth";

// Vite needs an explicit URL to the worker asset (pdfjs can't locate it via
// its own default heuristics inside a bundled build) — this resolves to a
// fingerprinted file in dist/ at build time, same trick as any other
// worker/wasm asset import.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const GSI_SRC = "https://accounts.google.com/gsi/client";

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

async function driveFetch(url: string, accessToken: string): Promise<Response> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
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
export async function listFolderFiles(folderId: string, accessToken: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await driveFetch(url, accessToken);
  const data = await res.json();
  return (data.files || []) as DriveFile[];
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
  depth = 0
): Promise<DriveFileWithPath[]> {
  if (depth > MAX_FOLDER_DEPTH) return [];
  const entries = await listFolderFiles(folderId, accessToken);
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path ? `${path}/${entry.name}` : entry.name;
      if (entry.mimeType === FOLDER_MIME) return listFolderFilesRecursive(entry.id, accessToken, entryPath, depth + 1);
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
async function extractPdfText(bytes: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages.join("\n\n");
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/tiff"]);

export async function exportFileText(file: DriveFile, accessToken: string): Promise<string | null> {
  if (file.mimeType in GOOGLE_EXPORT_MIME) {
    const mime = encodeURIComponent(GOOGLE_EXPORT_MIME[file.mimeType]);
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${mime}&supportsAllDrives=true`, accessToken);
    return res.text();
  }
  if (file.mimeType === "text/plain" || file.mimeType === "text/csv") {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, accessToken);
    return res.text();
  }
  if (file.mimeType === "application/pdf") {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, accessToken);
    return extractPdfText(await res.arrayBuffer());
  }
  if (file.mimeType === DOCX_MIME) {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, accessToken);
    const { value } = await mammoth.extractRawText({ arrayBuffer: await res.arrayBuffer() });
    return value;
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
export async function exportFileImageDataUrl(file: DriveFile, accessToken: string): Promise<string> {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, accessToken);
  const base64 = arrayBufferToBase64(await res.arrayBuffer());
  return `data:${file.mimeType};base64,${base64}`;
}
