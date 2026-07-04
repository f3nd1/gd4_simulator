import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import { requestDriveAccessToken, DriveAuthError } from "../lib/drive/driveClient";

// Only the Client ID is persisted (it's not a secret — Google's browser
// token-client flow needs no client secret). The access token is short-lived
// (~1 hour) and kept in memory only, never written to localStorage, mirroring
// why the OpenAI key has its own warning on Settings but is a different kind
// of credential: this one is requested fresh from Google on each "Connect".
export type GoogleDriveState = {
  clientId: string;
  accessToken: string | null;
  tokenExpiresAt: number | null;
  connecting: boolean;
  lastError: string | null;

  setClientId: (clientId: string) => void;
  connect: () => Promise<void>;
  connectSilently: () => Promise<void>;
  disconnect: () => void;
  getValidToken: () => string | null;
  // Returns a currently-valid token, silently re-authing first if the cached
  // one has expired (Google tokens last ~1 hour; a long audit sweep will cross
  // that). Returns null when a fresh token cannot be minted without user
  // interaction — callers must then STOP the run with a clear message rather
  // than proceed with unreadable files.
  getFreshToken: () => Promise<string | null>;
};

export const useGoogleDriveStore = create<GoogleDriveState>()(
  persist(
    (set, get) => ({
      clientId: "",
      accessToken: null,
      tokenExpiresAt: null,
      connecting: false,
      lastError: null,

      setClientId: (clientId) => set({ clientId }),

      connect: async () => {
        set({ connecting: true, lastError: null });
        try {
          const { accessToken, expiresInSeconds } = await requestDriveAccessToken(get().clientId);
          set({ accessToken, tokenExpiresAt: Date.now() + expiresInSeconds * 1000, connecting: false });
        } catch (err) {
          const message = err instanceof DriveAuthError ? err.message : err instanceof Error ? err.message : String(err);
          set({ connecting: false, lastError: message });
          throw err;
        }
      },

      // Best-effort, silent re-connect attempted on page load (see Layout.tsx)
      // so a returning user doesn't have to click "Connect" every reload just
      // because the access token itself is never persisted. Failures here are
      // expected (no prior consent, session expired, third-party cookies
      // blocked) and stay quiet — they fall back to the existing "Not
      // connected" state rather than surfacing as an error.
      connectSilently: async () => {
        const { clientId, accessToken } = get();
        if (!clientId || accessToken) return;
        try {
          const { accessToken: token, expiresInSeconds } = await requestDriveAccessToken(clientId, { silent: true });
          set({ accessToken: token, tokenExpiresAt: Date.now() + expiresInSeconds * 1000 });
        } catch {
          // Stay disconnected; the user can still click "Connect Google Drive" manually.
        }
      },

      disconnect: () => set({ accessToken: null, tokenExpiresAt: null, lastError: null }),

      getValidToken: () => {
        const { accessToken, tokenExpiresAt } = get();
        if (!accessToken || !tokenExpiresAt || Date.now() >= tokenExpiresAt) return null;
        return accessToken;
      },

      getFreshToken: async () => {
        // Refresh slightly BEFORE expiry so a token that dies mid-file-read
        // never gets used: treat anything within 60s of expiry as expired.
        const { accessToken, tokenExpiresAt, clientId } = get();
        if (accessToken && tokenExpiresAt && Date.now() < tokenExpiresAt - 60_000) return accessToken;
        if (!clientId) return null;
        try {
          const { accessToken: token, expiresInSeconds } = await requestDriveAccessToken(clientId, { silent: true });
          set({ accessToken: token, tokenExpiresAt: Date.now() + expiresInSeconds * 1000 });
          return token;
        } catch {
          return null; // silent re-auth failed — caller must stop the run
        }
      },
    }),
    {
      name: "ucc-gd4-google-drive:v1",
      storage: workspaceStorage,
      partialize: (s) => ({ clientId: s.clientId }),
    }
  )
);
