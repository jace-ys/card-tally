import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type {
  Entry,
  EntryListFilter,
  Payee,
  Statement,
  StatementFormat,
  StatementPayeeSummary,
} from "../types/api";
import { ErrorBanner } from "../components/ErrorBanner";
import { EntriesTable } from "../components/EntriesTable";
import { formatAmount } from "../lib/format";

const FORMATS: StatementFormat[] = ["amex", "yonder"];
const ENTRY_FILTER_STORAGE_KEY = "card-tally.entry-filter";

type DeferredEntryRow = Entry & {
  statementName: string;
  statementFormat: StatementFormat;
};

function readPersistedEntryFilter(): EntryListFilter {
  if (typeof window === "undefined") return "all";
  const raw = window.localStorage.getItem(ENTRY_FILTER_STORAGE_KEY);
  if (
    raw === "all" ||
    raw === "active" ||
    raw === "deferred" ||
    raw === "paid_archived"
  ) {
    return raw;
  }
  return "all";
}

function tabDate(importedAt: string): string {
  const d = new Date(importedAt);
  if (Number.isNaN(d.getTime())) return importedAt;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function StatementsPage() {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedFormatTab, setSelectedFormatTab] = useState<StatementFormat | null>(
    null
  );
  const [entries, setEntries] = useState<Entry[]>([]);
  const [deferredEntries, setDeferredEntries] = useState<DeferredEntryRow[]>([]);
  const [loadingDeferred, setLoadingDeferred] = useState(false);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [summary, setSummary] = useState<StatementPayeeSummary | null>(null);
  const [entryFilter, setEntryFilter] = useState<EntryListFilter>(
    readPersistedEntryFilter
  );
  const [error, setError] = useState<Error | null>(null);
  const [loadingStatements, setLoadingStatements] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFormat, setUploadFormat] = useState<StatementFormat>("amex");
  const [uploadName, setUploadName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deletingStatement, setDeletingStatement] = useState(false);
  const [deletingStatementId, setDeletingStatementId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const openStatements = statements.filter((s) => s.openEntryCount > 0);
  const openFormats = Array.from(new Set(openStatements.map((s) => s.format)));
  const visibleFormat = selectedFormatTab ?? openFormats[0] ?? null;
  const visibleStatements = visibleFormat
    ? openStatements.filter((s) => s.format === visibleFormat)
    : [];

  const loadDeferredEntries = useCallback(async (statementList: Statement[]) => {
    if (statementList.length === 0) {
      setDeferredEntries([]);
      return;
    }
    setLoadingDeferred(true);
    try {
      const rowsByStatement = await Promise.all(
        statementList.map(async (statement) => {
          const rows = await api.listEntries(statement.id, "deferred");
          return rows.map((entry) => ({
            ...entry,
            statementName: statement.name,
            statementFormat: statement.format,
          }));
        })
      );
      const flattened = rowsByStatement
        .flat()
        .sort((a, b) => b.date.localeCompare(a.date));
      setDeferredEntries(flattened);
    } catch {
      // Keep this non-blocking for the main statements flow.
    } finally {
      setLoadingDeferred(false);
    }
  }, []);

  const loadStatements = useCallback(
    async (opts?: { quiet?: boolean }) => {
      const quiet = opts?.quiet ?? false;
      if (!quiet) {
        setError(null);
        setLoadingStatements(true);
      }
      try {
        const list = await api.listStatements();
        setStatements(list);
        setSelectedId((prev) => {
          const open = list.filter((s) => s.openEntryCount > 0);
          if (prev != null && open.some((s) => s.id === prev)) return prev;
          return open[0]?.id ?? null;
        });
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!quiet) {
          setLoadingStatements(false);
        }
      }
    },
    []
  );

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
    void loadStatements();
    void loadPayees();
  }, [loadStatements, loadPayees]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ENTRY_FILTER_STORAGE_KEY, entryFilter);
  }, [entryFilter]);

  useEffect(() => {
    if (openFormats.length === 0) {
      setSelectedFormatTab(null);
      return;
    }
    const selectedStatement = openStatements.find((s) => s.id === selectedId);
    const fromSelected = selectedStatement?.format ?? null;
    if (fromSelected && openFormats.includes(fromSelected)) {
      setSelectedFormatTab(fromSelected);
      return;
    }
    if (selectedFormatTab && openFormats.includes(selectedFormatTab)) return;
    setSelectedFormatTab(openFormats[0]);
  }, [openFormats, openStatements, selectedId, selectedFormatTab]);

  useEffect(() => {
    void loadDeferredEntries(statements);
  }, [statements, loadDeferredEntries]);

  const loadEntries = useCallback(async () => {
    if (!selectedId) {
      setEntries([]);
      return;
    }
    setLoadingEntries(true);
    setError(null);
    try {
      const list = await api.listEntries(selectedId, entryFilter);
      setEntries(list);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoadingEntries(false);
    }
  }, [selectedId, entryFilter]);

  const loadSummary = useCallback(async () => {
    if (!selectedId) {
      setSummary(null);
      return;
    }
    try {
      const s = await api.statementPayeeSummary(selectedId);
      setSummary(s);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [selectedId]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    setError(null);
    try {
      const st = await api.importStatementCsv({
        file: uploadFile,
        format: uploadFormat,
        name: uploadName.trim() || undefined,
      });
      await loadStatements();
      setSelectedId(st.id);
      setUploadFile(null);
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      setUploadName("");
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setUploading(false);
    }
  }

  async function deleteStatementById(statementId: number) {
    const statement = statements.find((s) => s.id === statementId);
    const label = statement?.name ?? `Statement ${statementId}`;
    if (
      !confirm(
        `Delete "${label}"?\n\nThis will delete all entries in this statement (including archived).`
      )
    ) {
      return;
    }
    setDeletingStatement(true);
    setDeletingStatementId(statementId);
    setError(null);
    setNotice(null);
    try {
      await api.deleteStatement(statementId);
      setNotice(`✅ Deleted "${label}".`);
      const nextStatements = await api.listStatements();
      setStatements(nextStatements);
      const nextOpen = nextStatements.filter((s) => s.openEntryCount > 0);
      const nextId =
        selectedId === statementId
          ? (nextOpen[0]?.id ?? null)
          : (selectedId ?? nextOpen[0]?.id ?? null);
      setSelectedId(nextId);
      if (nextId == null) {
        setEntries([]);
        setSummary(null);
      } else {
        const [nextEntries, nextSummary] = await Promise.all([
          api.listEntries(nextId, entryFilter),
          api.statementPayeeSummary(nextId),
        ]);
        setEntries(nextEntries);
        setSummary(nextSummary);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setDeletingStatement(false);
      setDeletingStatementId(null);
    }
  }

  function formatTypeLabel(format: StatementFormat): string {
    return format === "amex" ? "Amex" : "Yonder";
  }

  function payeeLabel(payeeId: number | null): string {
    if (payeeId == null) return "— Unassigned —";
    return payees.find((p) => p.id === payeeId)?.name ?? String(payeeId);
  }

  return (
    <>
      <ErrorBanner error={error} />
      {notice && <p className="success-banner">{notice}</p>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>📥 Import CSV</h2>
        <form onSubmit={onUpload} className="toolbar">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="csv-file">Statement file</label>
            <input
              ref={uploadInputRef}
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(ev) =>
                setUploadFile(ev.target.files?.[0] ?? null)
              }
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="csv-format">Format</label>
            <select
              id="csv-format"
              value={uploadFormat}
              onChange={(e) =>
                setUploadFormat(e.target.value as StatementFormat)
              }
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="csv-name">Label (optional)</label>
            <input
              id="csv-name"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              placeholder="March 2026"
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!uploadFile || uploading}
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </form>
      </div>

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
          <h2 style={{ margin: 0 }}>🧾 Statements</h2>
          <Link className="btn" to="/organizer">
            ⚡ Quick organizer
          </Link>
        </div>
        {loadingStatements ? (
          <p className="hint">Loading statements…</p>
        ) : statements.length === 0 ? (
          <p className="hint">No statements yet. Upload a CSV to begin.</p>
        ) : openStatements.length === 0 ? (
          <p className="hint">
            No open statements in tabs. Fully paid statements are in Archive.
          </p>
        ) : (
          <>
            <div className="tabs format-tabs" role="tablist" aria-label="Statement types">
              {openFormats.map((format) => (
                <button
                  key={format}
                  type="button"
                  role="tab"
                  aria-selected={visibleFormat === format}
                  className={`tab format-tab${visibleFormat === format ? " active" : ""}`}
                  onClick={() => {
                    setSelectedFormatTab(format);
                    const first = openStatements.find((s) => s.format === format);
                    if (first) {
                      setSelectedId(first.id);
                    }
                  }}
                >
                  <span className="format-tab-label">{formatTypeLabel(format)}</span>
                </button>
              ))}
            </div>
            <div className="tabs statement-subtabs" role="tablist" aria-label="Statements">
              {visibleStatements.map((s) => (
                <span
                  key={s.id}
                  className={`tab-wrap${selectedId === s.id ? " active" : ""}`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedId === s.id}
                    className={`tab${selectedId === s.id ? " active" : ""}`}
                    onClick={() => {
                      setSelectedFormatTab(s.format);
                      setSelectedId(s.id);
                    }}
                  >
                    <span className="tab-name">{s.name}</span>
                    <span className="tab-date">{tabDate(s.importedAt)}</span>
                  </button>
                  <button
                    type="button"
                    className="tab-delete"
                    title={`Delete ${s.name}`}
                    aria-label={`Delete ${s.name}`}
                    disabled={deletingStatement && deletingStatementId === s.id}
                    onClick={() => void deleteStatementById(s.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </>
        )}

        {selectedId && (
          <>
            <div className="statements-controls">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="entry-filter">🔎 Show entries</label>
                <select
                  id="entry-filter"
                  value={entryFilter}
                  onChange={(e) =>
                    setEntryFilter(e.target.value as EntryListFilter)
                  }
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active only</option>
                  <option value="deferred">Deferred only</option>
                  <option value="paid_archived">Paid (archived) only</option>
                </select>
              </div>
              {loadingEntries && (
                <span className="hint">Refreshing entries…</span>
              )}
            </div>
            <EntriesTable
              entries={entries}
              payees={payees}
              statementFormat={
                statements.find((s) => s.id === selectedId)?.format ?? null
              }
              onUpdated={() => {
                void loadEntries();
                void loadSummary();
                void loadStatements({ quiet: true });
              }}
            />
          </>
        )}
      </div>

      {summary && summary.rows.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>💸 Summary by payee</h2>
          <p className="hint">{summary.statementName}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Payee</th>
                  <th>Entries</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.payeeId}>
                    <td>{r.payeeName}</td>
                    <td>{r.entryCount}</td>
                    <td>{formatAmount(r.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>🕒 Deferred payments</h2>
        {loadingDeferred ? (
          <p className="hint">Loading deferred payments…</p>
        ) : deferredEntries.length === 0 ? (
          <p className="hint">No deferred payments right now. Nice.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Statement</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Merchant</th>
                  <th>Amount</th>
                  <th>Payee</th>
                </tr>
              </thead>
              <tbody>
                {deferredEntries.map((entry) => (
                  <tr key={`deferred-${entry.id}`}>
                    <td>
                      <button
                        type="button"
                        className="inline-link-btn"
                        onClick={() => {
                          setSelectedFormatTab(entry.statementFormat);
                          setSelectedId(entry.statementId);
                        }}
                      >
                        {entry.statementName}
                      </button>
                    </td>
                    <td>{formatTypeLabel(entry.statementFormat)}</td>
                    <td>{entry.date}</td>
                    <td>{entry.merchant}</td>
                    <td>{formatAmount(entry.amount)}</td>
                    <td>{payeeLabel(entry.payeeId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </>
  );
}
