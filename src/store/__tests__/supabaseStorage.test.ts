import { describe, it, expect, beforeEach, vi } from "vitest";

// A failed remote save used to be discarded, and the read path then preferred
// the older remote row and overwrote the newer local cache — turning one
// transient failure into permanently lost work. These pin both halves, plus
// the durability barrier that five callers in useWorkspaceStore await.

const upsert = vi.fn();
const maybeSingle = vi.fn();
// Signed in by default. The adapter now refuses to read or write remotely
// without a session, because an anonymous read comes back EMPTY under the
// row-level policy and a store that hydrated empty would save its defaults
// over the real row. The signed-out case is pinned in its own test below.
let session: unknown = { user: { email: "felix@unitedceres.edu.sg" } };
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session } }) },
  from: () => ({
    upsert: (row: unknown) => upsert(row),
    select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }),
    delete: () => ({ eq: () => Promise.resolve({}) }),
  }),
};
const getSupabaseClient = vi.fn(() => client);
vi.mock("../../lib/supabaseClient", () => ({ getSupabaseClient: () => getSupabaseClient() }));
vi.mock("../useSaveStatusStore", () => ({
  useSaveStatusStore: { getState: () => ({ markSaving() {}, markSaved() {}, markError() {}, markLocalSaveError() {}, clearLocalSaveError() {} }) },
}));

// The real store tests run without localStorage; the unsynced marker needs one.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});

const mod = await import("../supabaseStorage");
const { flushPendingSaves, workspaceStorage } = mod;

const KEY = "test-key";
const put = (v: unknown) => workspaceStorage!.setItem(KEY, v as never);

beforeEach(() => {
  session = { user: { email: "felix@unitedceres.edu.sg" } };
  store.clear();
  upsert.mockReset();
  maybeSingle.mockReset();
  getSupabaseClient.mockReturnValue(client);
});

describe("issue 6 — a failed save is requeued, not dropped", () => {
  it("keeps the value queued when the upsert returns an error, and a later flush retries it", async () => {
    upsert.mockResolvedValueOnce({ error: { message: "boom" } });
    void put({ state: { n: 1 }, version: 0 });
    await flushPendingSaves();
    expect(upsert).toHaveBeenCalledTimes(1);

    upsert.mockResolvedValueOnce({ error: null });
    await flushPendingSaves();
    expect(upsert).toHaveBeenCalledTimes(2);
    // Same payload retried, not a fresh empty one. `updated_at` is stamped per
    // attempt, so compare the data the row carries rather than the whole row.
    const dataOf = (i: number) => JSON.stringify((upsert.mock.calls[i][0] as { data: unknown }).data);
    expect(dataOf(1)).toBe(dataOf(0));
    expect(dataOf(0)).toContain('"n":1');
  });

  it("keeps the value queued when the upsert throws", async () => {
    upsert.mockRejectedValueOnce(new Error("network"));
    void put({ state: { n: 2 }, version: 0 });
    await flushPendingSaves();

    upsert.mockResolvedValueOnce({ error: null });
    await flushPendingSaves();
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("does not drop the value when the client is unavailable", async () => {
    void put({ state: { n: 3 }, version: 0 });
    getSupabaseClient.mockReturnValue(null as never);
    await flushPendingSaves();
    expect(upsert).not.toHaveBeenCalled();

    getSupabaseClient.mockReturnValue(client);
    upsert.mockResolvedValueOnce({ error: null });
    await flushPendingSaves();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("marks the key unsynced on failure and clears it on success", async () => {
    upsert.mockResolvedValueOnce({ error: { message: "boom" } });
    void put({ state: { n: 4 }, version: 0 });
    await flushPendingSaves();
    expect(store.get(`${KEY}::unsynced`)).toBeDefined();

    upsert.mockResolvedValueOnce({ error: null });
    await flushPendingSaves();
    expect(store.get(`${KEY}::unsynced`)).toBeUndefined();
  });
});

describe("issue 6 — an older remote row never overwrites newer local work", () => {
  it("serves the local copy while the key is unsynced, and leaves the cache intact", async () => {
    upsert.mockResolvedValueOnce({ error: { message: "boom" } });
    void put({ state: { n: "NEW" }, version: 0 });
    await flushPendingSaves();

    const localBefore = store.get(KEY);
    maybeSingle.mockResolvedValueOnce({ data: { data: { state: { n: "OLD" } } }, error: null });
    const read = await workspaceStorage!.getItem(KEY);

    expect(JSON.stringify(read)).toContain("NEW");
    expect(store.get(KEY)).toBe(localBefore);
  });

  it("prefers the remote row once the key is in sync", async () => {
    upsert.mockResolvedValueOnce({ error: null });
    void put({ state: { n: "LOCAL" }, version: 0 });
    await flushPendingSaves();

    maybeSingle.mockResolvedValueOnce({ data: { data: { state: { n: "REMOTE" } } }, error: null });
    expect(JSON.stringify(await workspaceStorage!.getItem(KEY))).toContain("REMOTE");
  });
});

describe("issue 7 — flushPendingSaves is a real durability barrier", () => {
  it("waits for an upload that is already in flight with nothing queued", async () => {
    let release!: () => void;
    upsert.mockImplementationOnce(() => new Promise((r) => { release = () => r({ error: null }); }));
    void put({ state: { n: 5 }, version: 0 });

    const inFlight = flushPendingSaves();          // starts the upload
    let settled = false;
    const barrier = flushPendingSaves().then(() => { settled = true; });
    // The adapter now awaits the session before it uploads, so the upload
    // starts a few microtasks later than it used to.
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(settled).toBe(false);                   // must not resolve early

    release();
    await Promise.all([inFlight, barrier]);
    expect(settled).toBe(true);
  });

  it("waits for a newer value queued behind an in-flight upload", async () => {
    let release!: () => void;
    upsert.mockImplementationOnce(() => new Promise((r) => { release = () => r({ error: null }); }));
    upsert.mockResolvedValueOnce({ error: null });

    void put({ state: { n: "first" }, version: 0 });
    const first = flushPendingSaves();
    void put({ state: { n: "second" }, version: 0 });

    let settled = false;
    const barrier = flushPendingSaves().then(() => { settled = true; });
    // As above: the session is awaited before the upload starts.
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(settled).toBe(false);

    release();
    await Promise.all([first, barrier]);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(upsert.mock.calls[1][0])).toContain("second");
  });
});


// ── The ordering bug the sign-in gate exposed ──────────────────────────────
//
// Reproduced on the built bundle at the real subpath: on the load that
// follows the Google redirect, all 16 persisted stores hydrated BEFORE the
// session existed, every read came back empty under the new policy, and
// three stores then wrote their defaults back, including the main workspace
// with an empty cycle.
describe("the session comes before the stored state", () => {
  it("does not ask the database until the session is settled", async () => {
    session = null;
    store.set(KEY, JSON.stringify({ local: true }));
    const got = await workspaceStorage!.getItem(KEY);
    // The local cache, not an empty remote answer dressed up as the truth.
    expect(got).toEqual({ local: true });
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("reads the database once there IS a session", async () => {
    maybeSingle.mockResolvedValue({ data: { data: { remote: true } }, error: null });
    const got = await workspaceStorage!.getItem(KEY);
    expect(maybeSingle).toHaveBeenCalled();
    expect(got).toEqual({ remote: true });
  });

  it("NEVER publishes while signed out, and keeps the value for later", async () => {
    upsert.mockResolvedValue({ error: null });
    session = null;
    put({ a: 1 });
    await flushPendingSaves();
    expect(upsert).not.toHaveBeenCalled();
    // Queued, not dropped: it goes up once somebody is signed in.
    session = { user: { email: "felix@unitedceres.edu.sg" } };
    await flushPendingSaves();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({ id: KEY });
  });
});
