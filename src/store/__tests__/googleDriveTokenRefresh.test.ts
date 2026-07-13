// Option A (server-side Drive refresh token): getFreshToken/connectSilently
// now mint access tokens by calling the drive-oauth Supabase Edge Function
// (via supabase.functions.invoke) instead of a client-only Google silent
// reauth — the run-start call sites from the earlier Task 1 (runPPDReview,
// runEvidenceAssessment, auditFolderContents, auditFolderStaged,
// auditAllFolders, auditChangedFolders) are unchanged; they still just call
// getFreshToken(). This tests the mechanism they all route through.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

vi.mock("../../lib/supabaseClient", () => ({ getSupabaseClient: vi.fn() }));

const { getSupabaseClient } = await import("../../lib/supabaseClient");
const { useGoogleDriveStore } = await import("../useGoogleDriveStore");

const mockGetClient = vi.mocked(getSupabaseClient);
const mockInvoke = vi.fn();

beforeEach(() => {
  mockInvoke.mockReset();
  mockGetClient.mockReturnValue({ functions: { invoke: mockInvoke } } as never);
  useGoogleDriveStore.setState({ clientId: "CID", accessToken: null, tokenExpiresAt: null, connecting: false, lastError: null });
});

describe("getFreshToken — calls the drive-oauth Edge Function's refresh action", () => {
  it("returns the current token unchanged when it still has plenty of life left (no Edge Function call)", async () => {
    useGoogleDriveStore.setState({ accessToken: "TOK-CURRENT", tokenExpiresAt: Date.now() + 30 * 60_000 });
    const token = await useGoogleDriveStore.getState().getFreshToken();
    expect(token).toBe("TOK-CURRENT");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("refreshes an already-expired token via the server, without any Google popup", async () => {
    useGoogleDriveStore.setState({ accessToken: "TOK-OLD", tokenExpiresAt: Date.now() - 1000 });
    mockInvoke.mockResolvedValue({ data: { accessToken: "TOK-FRESH", expiresInSeconds: 3600 }, error: null });
    const token = await useGoogleDriveStore.getState().getFreshToken();
    expect(token).toBe("TOK-FRESH");
    expect(mockInvoke).toHaveBeenCalledWith("drive-oauth", { body: { action: "refresh" } });
    expect(useGoogleDriveStore.getState().accessToken).toBe("TOK-FRESH");
  });

  it("also refreshes a token within 60s of expiring (the run-start read is about to happen)", async () => {
    useGoogleDriveStore.setState({ accessToken: "TOK-NEAR", tokenExpiresAt: Date.now() + 30_000 });
    mockInvoke.mockResolvedValue({ data: { accessToken: "TOK-FRESH2", expiresInSeconds: 3600 }, error: null });
    const token = await useGoogleDriveStore.getState().getFreshToken();
    expect(token).toBe("TOK-FRESH2");
  });

  it("returns null (never throws) when the stored refresh token was revoked — the honest-failure path checkDriveForRun still gates on", async () => {
    useGoogleDriveStore.setState({ accessToken: "TOK-OLD", tokenExpiresAt: Date.now() - 1000 });
    mockInvoke.mockResolvedValue({ data: { error: "Google Drive connection expired or was revoked — reconnect Google Drive in Settings." }, error: null });
    const token = await useGoogleDriveStore.getState().getFreshToken();
    expect(token).toBeNull();
    expect(useGoogleDriveStore.getState().accessToken).toBe("TOK-OLD"); // no partial/corrupt update
  });

  it("returns null when the Edge Function call itself fails (network error, not deployed yet)", async () => {
    useGoogleDriveStore.setState({ accessToken: "TOK-OLD", tokenExpiresAt: Date.now() - 1000 });
    mockInvoke.mockRejectedValue(new Error("fetch failed"));
    const token = await useGoogleDriveStore.getState().getFreshToken();
    expect(token).toBeNull();
  });

  it("returns null immediately with no Edge Function call when there's no clientId configured", async () => {
    useGoogleDriveStore.setState({ clientId: "", accessToken: "TOK-OLD", tokenExpiresAt: Date.now() - 1000 });
    const token = await useGoogleDriveStore.getState().getFreshToken();
    expect(token).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("returns null with a clear message when Supabase itself isn't configured", async () => {
    mockGetClient.mockReturnValue(null);
    useGoogleDriveStore.setState({ accessToken: "TOK-OLD", tokenExpiresAt: Date.now() - 1000 });
    const token = await useGoogleDriveStore.getState().getFreshToken();
    expect(token).toBeNull();
  });
});

describe("disconnect — tells the server to forget the stored refresh token", () => {
  it("clears local state immediately and calls the disconnect action", async () => {
    useGoogleDriveStore.setState({ accessToken: "TOK", tokenExpiresAt: Date.now() + 60_000 });
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    await useGoogleDriveStore.getState().disconnect();
    expect(useGoogleDriveStore.getState().accessToken).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith("drive-oauth", { body: { action: "disconnect" } });
  });
});
