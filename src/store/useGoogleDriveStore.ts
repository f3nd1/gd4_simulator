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
  disconnect: () => void;
  getValidToken: () => string | null;
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

      disconnect: () => set({ accessToken: null, tokenExpiresAt: null, lastError: null }),

      getValidToken: () => {
        const { accessToken, tokenExpiresAt } = get();
        if (!accessToken || !tokenExpiresAt || Date.now() >= tokenExpiresAt) return null;
        return accessToken;
      },
    }),
    {
      name: "ucc-gd4-google-drive:v1",
      storage: workspaceStorage,
      partialize: (s) => ({ clientId: s.clientId }),
    }
  )
);
