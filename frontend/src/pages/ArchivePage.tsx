import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type {
  Entry,
  Payee,
  Statement,
} from "../types/api";
import { ErrorBanner } from "../components/ErrorBanner";
import { formatAmount } from "../lib/format";

export function ArchivePage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingStatementId, setDeletingStatementId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [archived, allStatements, allPayees] = await Promise.all([
        api.listArchivedEntries(),
        api.listStatements(),
        api.listPayees(),
      ]);
      setEntries(archived);
      setStatements(allStatements);
      setPayees(allPayees);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byStatement = useMemo(() => {
    const m = new Map<number, Entry[]>();
    for (const e of entries) {
      const list = m.get(e.statementId) ?? [];
      list.push(e);
      m.set(e.statementId, list);
    }
    return m;
  }, [entries]);

  function statementName(id: number): string {
    return statements.find((s) => s.id === id)?.name ?? String(id);
  }

  function statementDate(id: number): string {
    const importedAt = statements.find((s) => s.id === id)?.importedAt;
    if (!importedAt) return "";
    const d = new Date(importedAt);
    if (Number.isNaN(d.getTime())) return importedAt;
    return d.toLocaleDateString();
  }

  async function deleteArchivedStatement(statementId: number) {
    const statement = statements.find((s) => s.id === statementId);
    const label = statement?.name ?? `Statement ${statementId}`;
    if (
      !confirm(
        `Delete "${label}"?\n\nThis will delete all entries in this statement (including archived).`
      )
    ) {
      return;
    }

    setDeletingStatementId(statementId);
    setError(null);
    setNotice(null);
    try {
      await api.deleteStatement(statementId);
      setNotice(`✅ Deleted "${label}".`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setDeletingStatementId(null);
    }
  }

  function payeeLabel(id: number | null): string {
    if (id == null) return "—";
    return payees.find((p) => p.id === id)?.name ?? String(id);
  }

  return (
    <>
      <ErrorBanner error={error} />
      {notice && <p className="hint">{notice}</p>}

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
          <h2 style={{ margin: 0 }}>🗂️ Archive</h2>
          <Link className="btn" to="/">
            🧾 Statements
          </Link>
        </div>
        <p className="hint">
          Entries with status <strong>Paid (archived)</strong>, grouped by statement.
        </p>
      </div>

      {loading ? (
        <p className="hint">Loading archive…</p>
      ) : entries.length === 0 ? (
        <div className="card">
          <p>No archived entries.</p>
        </div>
      ) : (
        [...byStatement.entries()].map(([sid, list]) => (
          <details key={sid} className="card" style={{ paddingTop: "0.6rem" }}>
            <summary
              style={{
                cursor: "pointer",
                fontWeight: 700,
                marginBottom: "0.6rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
              }}
            >
              <span>
                {statementName(sid)} {statementDate(sid) ? `(${statementDate(sid)})` : ""} -{" "}
                {list.length} archived
              </span>
              <button
                type="button"
                className="archive-delete"
                title={`Delete ${statementName(sid)}`}
                aria-label={`Delete ${statementName(sid)}`}
                disabled={deletingStatementId === sid}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void deleteArchivedStatement(sid);
                }}
              >
                {deletingStatementId === sid ? "…" : "×"}
              </button>
            </summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Merchant</th>
                    <th>Amount</th>
                    <th>Payee</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((e) => (
                    <tr key={e.id}>
                      <td>{e.date}</td>
                      <td>{e.merchant}</td>
                      <td>{formatAmount(e.amount)}</td>
                      <td>{payeeLabel(e.payeeId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))
      )}
    </>
  );
}
