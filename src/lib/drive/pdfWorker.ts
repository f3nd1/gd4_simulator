// Custom pdfjs worker entry: install the compat polyfills FIRST, then hand
// off to pdfjs's real worker. Using our own wrapper (loaded via Vite's
// ?worker import in driveClient) is the only way to get the polyfills into
// the worker's separate global scope, where the PDF parsing — and the
// ReadableStream usage that fails on Safari — actually runs.
import "./pdfCompat";
import "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
