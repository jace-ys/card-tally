import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Entry, Payee, Statement } from "../types/api";
import { ErrorBanner } from "../components/ErrorBanner";
import { formatAmount } from "../lib/format";

type Pending = { entryId: number; payeeId: number };

export function OrganizerPage() {
  const [statements, setStatements] = useState<Statement[]>([]);
  const [statementId, setStatementId] = useState<number | "">("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newPayeeName, setNewPayeeName] = useState("");
  const [payeeBusy, setPayeeBusy] = useState(false);

  const loadStatements = useCallback(async () => {
    try {
      const list = await api.listStatements();
      const open = list.filter((s) => s.openEntryCount > 0);
      setStatements(open);
      setStatementId((prev) => {
        if (prev !== "" && open.some((s) => s.id === prev)) return prev;
        return open[0]?.id ?? "";
      });
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, []);

  const loadPayees = useCallback(async () => {
    try {
      const list = await api.listPayees();
      list.sort((a, b) => a.sortOrder - b.sortOrder);
      setPayees(list);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadStatements();
      await loadPayees();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadStatements, loadPayees]);

  const loadEntries = useCallback(async () => {
    if (statementId === "") {
      setEntries([]);
      return;
    }
    setError(null);
    try {
      const list = await api.listEntries(statementId, "all");
      const open = list.filter(
        (e) => e.status === "active" && e.payeeId == null
      );
      setEntries(open);
      setIndex(0);
      setPending([]);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [statementId]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const slotMap = useMemo(() => {
    const ordered = [...payees].sort((a, b) => a.sortOrder - b.sortOrder);
    const m = new Map<number, Payee>();
    for (let i = 0; i < ordered.length && i < 9; i += 1) {
      m.set(i + 1, ordered[i]);
    }
    return m;
  }, [payees]);

  const current = entries[index] ?? null;

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (
        ev.target instanceof HTMLInputElement ||
        ev.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const cur = entries[index];
      if (!cur) return;
      const d = ev.key;
      if (d >= "1" && d <= "9") {
        const slot = Number(d);
        const p = slotMap.get(slot);
        if (p) {
          ev.preventDefault();
          setPending((prev) => {
            const rest = prev.filter((x) => x.entryId !== cur.id);
            return [...rest, { entryId: cur.id, payeeId: p.id }];
          });
          setIndex((i) => Math.min(i + 1, entries.length));
        }
      } else if (d === " " || d === "Enter") {
        ev.preventDefault();
        setIndex((i) => Math.min(i + 1, entries.length));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entries, index, slotMap]);

  async function saveBatch() {
    if (pending.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await api.batchUpdateEntries({
        updates: pending.map((p) => ({
          entryId: p.entryId,
          payeeId: p.payeeId,
        })),
      });
      setPending([]);
      await loadEntries();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setSaving(false);
    }
  }

  async function addPayee(e: React.FormEvent) {
    e.preventDefault();
    const name = newPayeeName.trim();
    if (!name) return;
    setPayeeBusy(true);
    setError(null);
    try {
      await api.createPayee({
        name,
        sortOrder: payees.length,
      });
      setNewPayeeName("");
      await loadPayees();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setPayeeBusy(false);
    }
  }

  async function removePayee(id: number) {
    if (!confirm("Remove this payee?")) return;
    setPayeeBusy(true);
    setError(null);
    try {
      await api.deletePayee(id);
      await loadPayees();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setPayeeBusy(false);
    }
  }

  const shortcuts = [...slotMap.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <>
      <ErrorBanner error={error} />

      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <h2 style={{ margin: 0 }}>⚡ Quick organizer</h2>
          <Link className="btn" to="/">
            🧾 Statements
          </Link>
        </div>
        <div className="field">
          <label htmlFor="org-statement">Statement</label>
          <select
            id="org-statement"
            value={statementId}
            onChange={(e) =>
              setStatementId(
                e.target.value === "" ? "" : Number(e.target.value)
              )
            }
          >
            {statements.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({new Date(s.importedAt).toLocaleDateString()})
              </option>
            ))}
          </select>
        </div>
        <p className="hint">
          Keys <strong>1</strong> to <strong>9</strong> assign payees in list order.{" "}
          <strong>Space</strong> or <strong>Enter</strong> skips without
          queuing a change. Pending assignments: {pending.length}.{" "}
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending.length === 0 || saving}
            onClick={() => void saveBatch()}
          >
            {saving ? "Saving…" : "Save batch"}
          </button>
        </p>
        {shortcuts.length > 0 && (
          <ul className="hint" style={{ marginTop: 0 }}>
            {shortcuts.map(([slot, p]) => (
              <li key={p.id}>
                <kbd>{slot}</kbd> → {p.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>👥 Payees</h2>
        <form onSubmit={addPayee} className="toolbar">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="organizer-payee-name">Name</label>
            <input
              id="organizer-payee-name"
              value={newPayeeName}
              onChange={(e) => setNewPayeeName(e.target.value)}
              placeholder="Partner"
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={payeeBusy}
          >
            Add payee
          </button>
        </form>
        <ul style={{ paddingLeft: "1.2rem" }}>
          {payees.map((p) => (
            <li key={p.id}>
              {p.name}
              <button
                type="button"
                className="btn"
                style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}
                disabled={payeeBusy}
                onClick={() => void removePayee(p.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      {loading ? (
        <p className="hint">Loading…</p>
      ) : statementId === "" ? (
        <p className="hint">No statements. Import one from the home screen.</p>
      ) : index >= entries.length ? (
        <div className="card">
          <p>Done with this queue.</p>
          {pending.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void saveBatch()}
            >
              Save {pending.length} assignment(s)
            </button>
          )}
          <button
            type="button"
            className="btn"
            style={{ marginLeft: "0.5rem" }}
            onClick={() => {
              void loadEntries();
            }}
          >
            Reload entries
          </button>
        </div>
      ) : (
        <div className="organizer-overlay" style={{ position: "relative", inset: "auto" }}>
          <div className="organizer-card" style={{ margin: "0 auto" }}>
            <div className="organizer-meta">
              Entry {index + 1} of {entries.length}
            </div>
            <p className="organizer-merchant">{current?.merchant}</p>
            <p className="organizer-amount">{formatAmount(current?.amount ?? "0")}</p>
            <p className="organizer-meta">{current?.date}</p>
            <p className="hint" style={{ marginBottom: 0 }}>
              Use number keys for payees, Space/Enter to skip.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
