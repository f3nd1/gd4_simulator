// Task 1 (Drive token stays alive during an active run): runPPDReview /
// runEvidenceAssessment / auditFolderContents / auditFolderStaged /
// auditAllFolders / auditChangedFolders all now fetch their run-start token
// via getFreshToken() instead of getValidToken(), so a near-/already-expired
// token is silently refreshed before the run's first Drive call instead of
// just blocking. This tests the shared mechanism those call sites all route
// through: refresh-and-succeed, and the honest failure when it can't.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

vi.mock("../../lib/drive/driveClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/drive/driveClient")>();
  return { ...actual, requestDriveAccessToken: vi.fn() };
});

const { requestDriveAccessToken } = await import("../../lib/drive/driveClient");
const { useGoogleDriveStore } = await import("../useGoogleDriveStore");

const mockRequest = vi.mocked(requestDriveAccessToken);

beforeEach(() => {
  mockRequest.mockReset();
  useGoogleDriveStore.setState({ clientId: "CID", accessToken: null, tokenExpiresAt: null, connecting: false, lastError: null });
});

describe("getFreshToken — the mechanism Task 1's run-start call sites now use", () => {
  it("returns the current token unchanged when it still has plenty of life left (no network call)", async () => {
    useGoogleDriveStore.setState({ accessToken: "TOK-CURRENT", tokenExpiresAt: Date.now() + 30 * 60_000 });
    const token = await useGoogleDriveStore.getState().getFreshToken();
    expect(token).toBe("TOK-CURRENT");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("silently refreshes an already-expired token before a run starts, without any user interaction", async () => {
    useGoogleDriveStore.setState({ accessToken: "TOK-OLD", tokenExpiresAt: Date.now() - 1000 });
    mockRequest.mockResolvedValue({ accessToken: "TOK-FRESH", expiresInSeconds: 3600 });
    const token = await useGoogleDriveStore.getState().getFreshToken();
    expect(token).toBe("TOK-FRESH");
    expect(mockRequest).toHaveBeenCalledWith("CID", { silent: true });
    expect(useGoogleDriveStore.getState().accessToken).toBe("TOK-FRESH");
  });

  it("also refreshes a token within 60s of expiring (the run-start read is about to happen)", async () => {
    useGoogleDriveStore.setState({ accessToken: "TOK-NEAR", tokenExpiresAt: Date.now() + 30_000 });
    mockRequest.mockResolvedValue({ accessToken: "TOK-FRESH2", expiresInSeconds: 3600 });
    const token = await useGoogleDriveStore.getState().getFreshToken();
    expect(token).toBe("TOK-FRESH2");
  });

  it("returns null (never throws) when silent refresh genuinely can't succeed — the honest-failure path checkDriveForRun still gates on", async () => {
    useGoogleDriveStore.setState({ accessToken: "TOK-OLD", tokenExpiresAt: Date.now() - 1000 });
    mockRequest.mockRejectedValue(new Error("blocked third-party cookies"));
    const token = await useGoogleDriveStore.getState().getFreshToken();
    expect(token).toBeNull();
    expect(useGoogleDriveStore.getState().accessToken).toBe("TOK-OLD"); // no partial/corrupt update
  });

  it("returns null immediately with no network call when there's no clientId to refresh with", async () => {
    useGoogleDriveStore.setState({ clientId: "", accessToken: "TOK-OLD", tokenExpiresAt: Date.now() - 1000 });
    const token = await useGoogleDriveStore.getState().getFreshToken();
    expect(token).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
