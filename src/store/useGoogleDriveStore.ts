import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import { getSupabaseClient } from "../lib/supabaseClient";
import { withDeadline } from "../lib/asyncGuards";
import { requestDriveAuthCode, DriveAuthError } from "../lib/drive/driveClient";

// Only the Client ID is persisted here (it's not a secret — Google's browser
// code-client flow needs no client secret ON THIS SIDE). The Google REFRESH
// token — the credential that makes reconnecting unnecessary — is held by
// the drive-oauth Supabase Edge Function (supabase/functions/drive-oauth),
// never by this store or this browser: see requestDriveAuthCode's doc
// comment in driveClient.ts and the Edge Function's own comments for the
// full exchange. The ACCESS token this store holds is still short-lived
// (~1hr) and kept in memory only, exactly as before — the difference is
// getFreshToken/connectSilently can now mint a new one from the server on
// demand, instead of needing a live Google popup/silent-reauth in this tab.
export type GoogleDriveState = {
  clientId: string;
  accessToken: string | null;
  tokenExpiresAt: number | null;
  connecting: boolean;
  lastError: string | null;

  setClientId: (clientId: string) => void;
  connect: () => Promise<void>;
  connectSilently: () => Promise<void>;
  disconnect: () => Promise<void>;
  getValidToken: () => string | null;
  getFreshToken: () => Promise<string | null>;
};

const EDGE_FUNCTION = "drive-oauth";
const EDGE_FUNCTION_TIMEOUT_MS = 15_000;

type DriveOauthResponse = { accessToken: string; expiresInSeconds: number } | { error: string };

// Invokes the drive-oauth Edge Function — the ONLY place a Google refresh
// token is read/written. Deadlined the same way requestDriveAuthCode's old
// silent-reauth path was: a network stall here must not freeze a run
// waiting for a token that will never arrive (see driveClient.ts history).
async function callDriveOauth(body: Record<string, unknown>): Promise<DriveOauthResponse> {
  const supabase = getSupabaseClient();
  if (!supabase) return { error: "Google Drive requires Supabase to be configured (Settings → Supabase database) — the refresh token is stored there, not in this browser." };
  try {
    const { data, error } = await withDeadline(
      supabase.functions.invoke<DriveOauthResponse>(EDGE_FUNCTION, { body }),
      EDGE_FUNCTION_TIMEOUT_MS,
      "Google Drive re-authentication timed out — the drive-oauth server function never responded."
    );
    if (error) return { error: error.message || "The drive-oauth Edge Function returned an error." };
    if (!data) return { error: "The drive-oauth Edge Function returned no data." };
    return data;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export const useGoogleDriveStore = create<GoogleDriveState>()(
  persist(
    (set, get) => ({
      clientId: "",
      accessToken: null,
      tokenExpiresAt: null,
      connecting: false,
      lastError: null,

      setClientId: (clientId) => set({ clientId }),

      // Interactive only (the user clicked "Connect Google Drive"): gets a
      // one-time authorization code from Google, then hands it to the Edge
      // Function to exchange server-side. No redirect_uri is sent: GIS's popup
      // flow delivers the code straight to a JS callback (never via a
      // redirect), so Google's token exchange expects the special literal
      // "postmessage" — hardcoded in the Edge Function, not passed from here
      // (see requestDriveAuthCode's comment). Sending this page's origin
      // instead makes Google reject the exchange with an invalid-grant /
      // redirect_uri_mismatch 400.
      connect: async () => {
        set({ connecting: true, lastError: null });
        try {
          const { code } = await requestDriveAuthCode(get().clientId);
          const result = await callDriveOauth({ action: "exchange", code });
          if ("error" in result) { set({ connecting: false, lastError: result.error }); throw new DriveAuthError(result.error); }
          set({ accessToken: result.accessToken, tokenExpiresAt: Date.now() + result.expiresInSeconds * 1000, connecting: false });
        } catch (err) {
          const message = err instanceof DriveAuthError ? err.message : err instanceof Error ? err.message : String(err);
          set({ connecting: false, lastError: message });
          throw err;
        }
      },

      // Best-effort, attempted on page load (see Layout.tsx) so a returning
      // user doesn't have to click "Connect" every reload. Unlike the old
      // GIS-silent-reauth version, this no longer depends on Google's own
      // session cookies or third-party-cookie policy in THIS browser — it
      // just asks the server "do you have a refresh token for this
      // workspace", so it succeeds as long as the connection was ever
      // established once and hasn't been revoked. Failures (never connected,
      // or the stored refresh token was revoked) stay quiet, same contract
      // as before — the user can still click "Connect Google Drive" manually.
      connectSilently: async () => {
        const { clientId, accessToken } = get();
        if (!clientId || accessToken) return;
        const result = await callDriveOauth({ action: "refresh" });
        if ("error" in result) return;
        set({ accessToken: result.accessToken, tokenExpiresAt: Date.now() + result.expiresInSeconds * 1000 });
      },

      // Also tells the server to forget (and best-effort revoke with Google)
      // the stored refresh token — otherwise "Disconnect" would be a lie:
      // connectSilently on the next reload would just silently reconnect.
      disconnect: async () => {
        set({ accessToken: null, tokenExpiresAt: null, lastError: null });
        await callDriveOauth({ action: "disconnect" });
      },

      getValidToken: () => {
        const { accessToken, tokenExpiresAt } = get();
        if (!accessToken || !tokenExpiresAt || Date.now() >= tokenExpiresAt) return null;
        return accessToken;
      },

      // Returns a currently-valid token, refreshing via the server first if
      // the cached one has expired (Google tokens last ~1 hour; a long audit
      // sweep will cross that). Returns null when a fresh token cannot be
      // minted — callers must then STOP the run with a clear message rather
      // than proceed with unreadable files.
      getFreshToken: async () => {
        // Refresh slightly BEFORE expiry so a token that dies mid-file-read
        // never gets used: treat anything within 60s of expiry as expired.
        const { accessToken, tokenExpiresAt, clientId } = get();
        if (accessToken && tokenExpiresAt && Date.now() < tokenExpiresAt - 60_000) return accessToken;
        if (!clientId) return null;
        const result = await callDriveOauth({ action: "refresh" });
        if ("error" in result) return null;
        set({ accessToken: result.accessToken, tokenExpiresAt: Date.now() + result.expiresInSeconds * 1000 });
        return result.accessToken;
      },
    }),
    {
      name: "ucc-gd4-google-drive:v1",
      storage: workspaceStorage,
      partialize: (s) => ({ clientId: s.clientId }),
    }
  )
);
