import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "../lib/supabaseClient";
import { useSession } from "../lib/auth/useSession";
import { isAdminEmail } from "../lib/auth/domain";
import {
  listPeople, addPerson, removePerson, checkAddress,
  removalBlockedReason, removalConsequence, type Person,
} from "../lib/auth/peopleAdmin";
import { INK } from "../lib/theme";
import { listGrants, grantAdmin, revokeAdmin, GRANT_CONSEQUENCE, type Grant } from "../lib/auth/adminGrants";
import { NOTABLE_ADMIN_PATHS, protectionFor, PROTECTION_LABEL, PROTECTION_MEANING, READ_CAVEAT, EVERYTHING_ELSE_NOTE, LOCKED_STORE_KEYS } from "../lib/auth/pageAccess";
import { NAV } from "../nav";

// Who can sign in, managed from inside the app instead of the Supabase
// dashboard. The route guard (PeopleRoute) keeps non-admins out of the page,
// but the page is NOT what protects the list: the insert and delete policies
// on allowed_users consult public.is_admin() on every write, including a write
// made with curl and the publishable key that ships in this bundle. Editing
// the guard in a browser gets you a screen whose every button is refused.
const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 18px", marginBottom: 14,
};
const muted: React.CSSProperties = { fontSize: 13, color: "#64748b", lineHeight: 1.6 };

export function People() {
  const state = useSession();
  const email = state.status === "signed-in" ? state.email : "";
  const [people, setPeople] = useState<Person[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Person | null>(null);
  const [done, setDone] = useState("");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [grantDraft, setGrantDraft] = useState("");
  const [grantMsg, setGrantMsg] = useState("");
  const isRoot = isAdminEmail(email);

  const refresh = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) { setLoadError("This app is not connected to its database."); return; }
    const got = await listPeople(supabase);
    if ("error" in got) { setLoadError(got.error); return; }
    setLoadError(""); setPeople(got.people);
    setGrants(await listGrants(supabase));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    setDone("");
    const check = checkAddress(draft, (people ?? []).map((p) => p.email));
    if (!check.ok) { setAddError(check.reason); return; }
    const supabase = getSupabaseClient();
    if (!supabase) { setAddError("This app is not connected to its database."); return; }
    setBusy(true); setAddError("");
    const res = await addPerson(supabase, check.email);
    setBusy(false);
    if (!res.ok) { setAddError(res.reason); return; }
    setDraft(""); setDone(`${check.email} can now sign in.`);
    await refresh();
  };

  const remove = async (p: Person) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setBusy(true);
    const res = await removePerson(supabase, p.email);
    setBusy(false); setConfirming(null);
    setDone(res.ok ? `${p.email} has been removed.` : res.reason);
    await refresh();
  };

  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 6px", color: INK }}>Who can sign in</h1>
      <p style={{ ...muted, margin: "0 0 4px" }}>
        Everyone on this list can open the app with their United Ceres Google account. Everyone else is
        refused, whatever they try. You are the only person who can change it.
      </p>
      <p style={{ ...muted, margin: "0 0 16px", fontSize: 12 }}>
        Changes take effect immediately. There is no invitation email: tell the person yourself once they are added.
      </p>

      {loadError && (
        <div style={{ ...card, background: "#fef2f2", borderColor: "#fecaca" }}>
          <b style={{ color: "#991b1b", fontSize: 14 }}>Could not load the list</b>
          <p style={{ ...muted, margin: "6px 0 0", color: "#991b1b" }}>{loadError}</p>
        </div>
      )}

      <div style={card}>
        <b style={{ fontSize: 14, color: INK }}>Add somebody</b>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <input
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setAddError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
            placeholder="name@unitedceres.edu.sg"
            aria-label="Email address to add"
            style={{ flex: "1 1 260px", minWidth: 0, boxSizing: "border-box", padding: "9px 11px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 8 }}
          />
          <button
            type="button" onClick={() => { void add(); }} disabled={busy}
            style={{ flexShrink: 0, cursor: busy ? "default" : "pointer", fontSize: 13, fontWeight: 700, padding: "9px 18px", borderRadius: 8, border: "1px solid #6d28d9", background: busy ? "#ede9fe" : "#6d28d9", color: busy ? "#6d28d9" : "#fff" }}
          >
            Add
          </button>
        </div>
        {addError && <p style={{ ...muted, margin: "8px 0 0", color: "#991b1b" }}>{addError}</p>}
        {done && !addError && <p style={{ ...muted, margin: "8px 0 0", color: "#166534" }}>{done}</p>}
      </div>

      <div style={card}>
        <b style={{ fontSize: 14, color: INK }}>
          On the list{people ? ` (${people.length})` : ""}
        </b>
        {people === null && !loadError && <p style={{ ...muted, margin: "8px 0 0" }}>Loading&hellip;</p>}
        {people?.length === 0 && <p style={{ ...muted, margin: "8px 0 0" }}>Nobody is on the list yet.</p>}
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 8 }}>
          {(people ?? []).map((p) => {
            const pinned = removalBlockedReason(p.email);
            return (
              <li
                key={p.email}
                style={{
                  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                  border: `1px solid ${pinned ? "#ddd6fe" : "#e2e8f0"}`, borderRadius: 9,
                  padding: "9px 12px", background: pinned ? "#f5f3ff" : "#fff",
                }}
              >
                <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, overflowWrap: "anywhere" }}>
                    {p.email}
                    {isAdminEmail(p.email) && (
                      <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#5b21b6", background: "#ede9fe", border: "1px solid #ddd6fe", borderRadius: 5, padding: "1px 6px" }}>
                        You, admin
                      </span>
                    )}
                  </div>
                  {p.note && <div style={{ ...muted, fontSize: 12 }}>{p.note}</div>}
                  {/* The pinned row says WHY it has no button. Silent absence
                      of a control reads as a bug and invites the wrong
                      experiment. */}
                  {pinned && <div style={{ ...muted, fontSize: 11.5, marginTop: 2 }}>{pinned}</div>}
                </div>
                {!pinned && (
                  <button
                    type="button" onClick={() => { setDone(""); setConfirming(p); }} disabled={busy}
                    style={{ flexShrink: 0, cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: 7, border: "1px solid #cbd5e1", background: "#fff", color: "#991b1b" }}
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {done && <p style={{ ...muted, margin: "10px 0 0", color: done.includes("refused") ? "#991b1b" : "#166534" }}>{done}</p>}
      </div>

      {confirming && (
        <div
          role="dialog" aria-modal="true" aria-label="Remove from the list"
          onClick={() => setConfirming(null)}
          style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: "22px 20px", boxSizing: "border-box" }}>
            <h2 style={{ margin: 0, fontSize: 17, color: INK }}>Remove {confirming.email}?</h2>
            {/* Said here, at the moment it happens, because two thirds of it is
                the part people get wrong. */}
            <p style={{ ...muted, margin: "10px 0 0", background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 9, padding: "10px 12px" }}>
              {removalConsequence(confirming.email)}
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              <button type="button" onClick={() => { void remove(confirming); }} disabled={busy}
                style={{ flex: "1 1 150px", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: "10px 12px", borderRadius: 9, border: "1px solid #b91c1c", background: "#b91c1c", color: "#fff" }}>
                Remove from the list
              </button>
              <button type="button" onClick={() => setConfirming(null)}
                style={{ flex: "1 1 100px", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: "10px 12px", borderRadius: 9, border: "1px solid #cbd5e1", background: "#fff", color: INK }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Granting admin is the ROOT's alone. A granted admin can manage the
          sign-in list and the configuration pages, but cannot grant admin to
          anybody, including themselves, so there is no escalation chain and
          no way to lose the last admin. */}
      {isRoot && (
        <div style={card}>
          <b style={{ fontSize: 14, color: INK }}>Extra admins{grants.length ? ` (${grants.length})` : ""}</b>
          <p style={{ ...muted, margin: "6px 0 0" }}>{GRANT_CONSEQUENCE}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <input
              value={grantDraft}
              onChange={(e) => { setGrantDraft(e.target.value); setGrantMsg(""); }}
              placeholder="name@unitedceres.edu.sg"
              aria-label="Email address to make an admin"
              style={{ flex: "1 1 260px", minWidth: 0, boxSizing: "border-box", padding: "9px 11px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 8 }}
            />
            <button
              type="button" disabled={busy}
              onClick={() => { void (async () => {
                const check = checkAddress(grantDraft, grants.map((g) => g.email));
                if (!check.ok) { setGrantMsg(check.reason); return; }
                const supabase = getSupabaseClient();
                if (!supabase) return;
                setBusy(true);
                const res = await grantAdmin(supabase, check.email);
                setBusy(false);
                setGrantMsg(res.ok ? `${check.email} is now an admin.` : res.reason);
                if (res.ok) setGrantDraft("");
                await refresh();
              })(); }}
              style={{ flexShrink: 0, cursor: "pointer", fontSize: 13, fontWeight: 700, padding: "9px 18px", borderRadius: 8, border: "1px solid #6d28d9", background: "#6d28d9", color: "#fff" }}
            >
              Make admin
            </button>
          </div>
          {grantMsg && <p style={{ ...muted, margin: "8px 0 0", color: grantMsg.includes("now an admin") ? "#166534" : "#991b1b" }}>{grantMsg}</p>}
          <ul style={{ listStyle: "none", margin: grants.length ? "10px 0 0" : 0, padding: 0, display: "grid", gap: 8 }}>
            {grants.map((g) => (
              <li key={g.email} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", border: "1px solid #e2e8f0", borderRadius: 9, padding: "9px 12px" }}>
                <span style={{ flex: "1 1 240px", minWidth: 0, fontSize: 13.5, fontWeight: 700, color: INK, overflowWrap: "anywhere" }}>{g.email}</span>
                <button
                  type="button" disabled={busy}
                  onClick={() => { void (async () => {
                    const supabase = getSupabaseClient();
                    if (!supabase) return;
                    setBusy(true);
                    const res = await revokeAdmin(supabase, g.email);
                    setBusy(false);
                    setGrantMsg(res.ok ? `${g.email} is no longer an admin. They can still sign in.` : res.reason);
                    await refresh();
                  })(); }}
                  style={{ flexShrink: 0, cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: 7, border: "1px solid #cbd5e1", background: "#fff", color: "#991b1b" }}
                >
                  Take admin away
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* READ-ONLY on purpose. Tick boxes here would look like an access
          control and would not be one: what protects the ten locked rows is a
          policy in Postgres, which has to change in SQL anyway. A control
          implying protection it cannot deliver gets trusted at exactly the
          wrong moment. */}
      <div style={card}>
        <b style={{ fontSize: 14, color: INK }}>What a normal user cannot open</b>
        <p style={{ ...muted, margin: "6px 0 0", background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 9, padding: "9px 11px" }}>
          {READ_CAVEAT}
        </p>
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 6 }}>
          {NOTABLE_ADMIN_PATHS.map((path) => {
            const label = NAV.flatMap((g) => [...g.items, ...(g.tools ?? [])]).find((i) => i.path === path)?.label ?? path;
            const kind = protectionFor(path);
            const rows = Object.entries(LOCKED_STORE_KEYS).filter(([, v]) => v.path === path);
            return (
              <li key={path} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 11px" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{label}</span>
                  <span style={{
                    fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
                    borderRadius: 5, padding: "1px 6px",
                    color: kind === "locked" ? "#166534" : "#92400e",
                    background: kind === "locked" ? "#dcfce7" : "#fff7ed",
                    border: `1px solid ${kind === "locked" ? "#bbf7d0" : "#fdba74"}`,
                  }}>
                    {PROTECTION_LABEL[kind]}
                  </span>
                </div>
                <div style={{ ...muted, fontSize: 11.5, marginTop: 3 }}>{PROTECTION_MEANING[kind]}</div>
                {rows.length > 0 && (
                  <div style={{ ...muted, fontSize: 11.5, marginTop: 2 }}>
                    Refused for a normal user: {rows.map(([, v]) => v.what.toLowerCase()).join("; ")}.
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p style={{ ...muted, fontSize: 12, marginTop: 10 }}>{EVERYTHING_ELSE_NOTE}</p>
        <p style={{ ...muted, fontSize: 11.5, marginTop: 6 }}>
          This split is fixed in the app rather than set here, because changing it is a code and database change
          together. Ask for a page to be moved and it takes a minute.
        </p>
      </div>

      <p style={{ ...muted, fontSize: 12 }}>
        Signed in as {email}{isRoot ? " (main admin)" : " (admin)"}. The main admin address is set in the database and
        cannot be changed from here, so nobody can give themselves control of the list.
      </p>
    </div>
  );
}
