import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Entry, Payee, Statement } from "../types/api";
import { ErrorBanner } from "../components/ErrorBanner";
import { formatAmount } from "../lib/format";

type PendingDecision =
  | { entryId: number; action: "assign"; payeeId: number }
  | { entryId: number; action: "defer" };

export function OrganizerPage() {
  const [statements, setStatements] = useState<Statement[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState<PendingDecision[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newPayeeName, setNewPayeeName] = useState("");
  const [newPayeeColor, setNewPayeeColor] = useState("#5D53FF");
  const [payeeBusy, setPayeeBusy] = useState(false);

  const loadStatements = useCallback(async () => {
    try {
      const list = await api.listStatements();
      const open = list.filter((s) => s.openEntryCount > 0);
      setStatements(open);
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
    if (statements.length === 0) {
      setEntries([]);
      setIndex(0);
      setPending([]);
      return;
    }
    setError(null);
    try {
      const byStatement = await Promise.all(
        statements.map(async (statement) => {
          const list = await api.listEntries(statement.id, "all");
          return list.filter((e) => e.status === "active" && e.payeeId == null);
        })
      );
      setEntries(byStatement.flat());
      setIndex(0);
      setPending([]);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [statements]);

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
  const statementById = useMemo(() => {
    const map = new Map<number, Statement>();
    for (const statement of statements) map.set(statement.id, statement);
    return map;
  }, [statements]);

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
            return [...rest, { entryId: cur.id, action: "assign", payeeId: p.id }];
          });
          setIndex((i) => Math.min(i + 1, entries.length));
        }
      } else if (d === "0") {
        ev.preventDefault();
        setPending((prev) => {
          const rest = prev.filter((x) => x.entryId !== cur.id);
          return [...rest, { entryId: cur.id, action: "defer" }];
        });
        setIndex((i) => Math.min(i + 1, entries.length));
      } else if (d === "Backspace" || d === "ArrowLeft") {
        ev.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (d === " " || d === "Enter") {
        ev.preventDefault();
        setPending((prev) => prev.filter((x) => x.entryId !== cur.id));
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
        updates: pending.map((p) =>
          p.action === "assign"
            ? {
                entryId: p.entryId,
                payeeId: p.payeeId,
              }
            : {
                entryId: p.entryId,
                status: "deferred" as const,
              }
        ),
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
        color: newPayeeColor,
      });
      setNewPayeeName("");
      setNewPayeeColor("#5D53FF");
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

  async function changePayeeColor(id: number, color: string) {
    setPayeeBusy(true);
    setError(null);
    try {
      await api.updatePayee(id, { color });
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
        <h3 style={{ marginBottom: "0.4rem" }}>👥 Payees</h3>
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
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="organizer-payee-color">Color</label>
            <input
              id="organizer-payee-color"
              type="color"
              value={newPayeeColor}
              onChange={(e) => setNewPayeeColor(e.target.value.toUpperCase())}
              style={{ minWidth: "4rem", width: "4.2rem", padding: "0.2rem" }}
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
              <input
                type="color"
                value={p.color ?? "#B8C2E8"}
                disabled={payeeBusy}
                aria-label={`Color for ${p.name}`}
                style={{ marginLeft: "0.5rem", width: "2rem", minWidth: "2rem", padding: "0.1rem" }}
                onChange={(e) => void changePayeeColor(p.id, e.target.value.toUpperCase())}
              />
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
        <p className="hint">
          Processing all open statements automatically: <strong>{statements.length}</strong>
        </p>
        <p className="hint">
          Keys <strong>1</strong> to <strong>9</strong> assign payees in list order.{" "}
          <strong>0</strong> defers. <strong>Backspace</strong> or <strong>←</strong>{" "}
          rewinds. <strong>Space</strong> or <strong>Enter</strong> skips without
          queuing a change. Pending updates: {pending.length}.{" "}
          <button
            type="button"
            className="btn"
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            style={{ marginRight: "0.4rem" }}
          >
            Back
          </button>
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

      {loading ? (
        <p className="hint">Loading…</p>
      ) : statements.length === 0 ? (
        <p className="hint">No open statements. Import one from the home screen.</p>
      ) : index >= entries.length ? (
        <div className="card">
          <p>Done with all open statements.</p>
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
            <p className="organizer-meta" style={{ marginTop: "0.3rem" }}>
              {statementById.get(current?.statementId ?? -1)?.name ?? "Statement"}
            </p>
            <p className="organizer-merchant">{current?.merchant}</p>
            <p className="organizer-amount">{formatAmount(current?.amount ?? "0")}</p>
            <p className="organizer-meta">{current?.date}</p>
            <p className="hint" style={{ marginBottom: 0 }}>
              Use 1-9 for payees, 0 to defer, Backspace/Left to rewind, Space/Enter to skip.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
