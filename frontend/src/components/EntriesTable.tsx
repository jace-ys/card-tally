import { useMemo, useState } from "react";
import type { Entry, Payee, StatementFormat } from "../types/api";
import { api } from "../api/client";
import { formatAmount } from "../lib/format";
import { PayeeSelect } from "./PayeeSelect";
import { StatusSelect } from "./StatusSelect";

export function EntriesTable({
  entries,
  payees,
  statementFormat,
  onUpdated,
}: {
  entries: Entry[];
  payees: Payee[];
  statementFormat: StatementFormat | null;
  onUpdated: () => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkPayeeId, setBulkPayeeId] = useState<string>("");
  const [localError, setLocalError] = useState<string | null>(null);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedEntries = useMemo(
    () => entries.filter((e) => selectedSet.has(e.id)),
    [entries, selectedSet]
  );
  const hasUnassignedInSelection = selectedEntries.some((e) => e.payeeId == null);

  async function patchEntry(
    id: number,
    patch: { payeeId?: number | null; status?: Entry["status"] }
  ) {
    setBusyId(id);
    setLocalError(null);
    try {
      await api.patchEntry(id, patch);
      onUpdated();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  function toggleSelection(id: number, checked: boolean) {
    setSelectedIds((prev) => {
      if (checked) {
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter((x) => x !== id);
    });
  }

  function toggleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedIds(entries.map((e) => e.id));
      return;
    }
    setSelectedIds([]);
  }

  async function bulkSetStatus(status: Entry["status"]) {
    if (selectedIds.length === 0) return;
    if (status === "paid_archived" && hasUnassignedInSelection) {
      setLocalError("Assign payees before marking selected entries as Paid.");
      return;
    }
    setBulkBusy(true);
    setLocalError(null);
    try {
      await api.batchUpdateEntries({
        updates: selectedIds.map((entryId) => ({ entryId, status })),
      });
      setSelectedIds([]);
      onUpdated();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkAssignPayee() {
    if (selectedIds.length === 0 || bulkPayeeId === "") return;
    const payeeId = Number(bulkPayeeId);
    if (!Number.isFinite(payeeId)) return;
    setBulkBusy(true);
    setLocalError(null);
    try {
      await api.batchUpdateEntries({
        updates: selectedIds.map((entryId) => ({ entryId, payeeId })),
      });
      setSelectedIds([]);
      setBulkPayeeId("");
      onUpdated();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
    }
  }

  async function createRuleFromEntry(entry: Entry) {
    if (!statementFormat) return;
    if (entry.payeeId == null) {
      setLocalError("Assign a payee first, then create a rule from this entry.");
      return;
    }
    setBusyId(entry.id);
    setLocalError(null);
    try {
      await api.createRule({
        statementFormat,
        merchantExact: entry.merchant,
        payeeId: entry.payeeId,
      });
      onUpdated();
    } catch (err) {
      setLocalError(
        err instanceof Error
          ? `Failed to create rule: ${err.message}`
          : "Failed to create rule"
      );
    } finally {
      setBusyId(null);
    }
  }

  if (entries.length === 0) {
    return <p className="hint">No entries for this filter.</p>;
  }

  return (
    <>
      {localError && (
        <p className="hint" style={{ color: "#a91d59" }}>
          {localError}
        </p>
      )}
      <div className="bulk-actions-bar">
        <select
          aria-label="Bulk assign payee"
          value={bulkPayeeId}
          disabled={bulkBusy}
          onChange={(e) => setBulkPayeeId(e.target.value)}
        >
          <option value="">Assign selected to payee…</option>
          {payees.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={bulkBusy || selectedIds.length === 0 || bulkPayeeId === ""}
          onClick={() => void bulkAssignPayee()}
        >
          Assign selected
        </button>
        <button
          type="button"
          className="btn"
          disabled={bulkBusy || selectedIds.length === 0 || hasUnassignedInSelection}
          onClick={() => void bulkSetStatus("paid_archived")}
        >
          Mark selected as Paid
        </button>
        <button
          type="button"
          className="btn"
          disabled={bulkBusy || selectedIds.length === 0}
          onClick={() => void bulkSetStatus("deferred")}
        >
          Mark selected as Deferred
        </button>
        <span className="hint bulk-selected-count">{selectedIds.length} selected</span>
      </div>
      <div className="table-wrap">
        <table className="entries-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all entries"
                  checked={entries.length > 0 && selectedIds.length === entries.length}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                />
              </th>
              <th>Date</th>
              <th>Merchant</th>
              <th>Amount</th>
              <th>Payee</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select entry ${e.id}`}
                    checked={selectedSet.has(e.id)}
                    onChange={(ev) => toggleSelection(e.id, ev.target.checked)}
                  />
                </td>
                <td>{e.date}</td>
                <td>
                  <div className="merchant-main">
                    <div className="merchant-name">{e.merchant}</div>
                  </div>
                  <button
                    type="button"
                    className="btn rule-mini"
                    disabled={busyId === e.id || e.payeeId == null || statementFormat == null}
                    onClick={() => void createRuleFromEntry(e)}
                  >
                    Create rule
                  </button>
                </td>
                <td>{formatAmount(e.amount)}</td>
                <td>
                  <PayeeSelect
                    payees={payees}
                    value={e.payeeId}
                    disabled={busyId === e.id}
                    onChange={(payeeId) => patchEntry(e.id, { payeeId })}
                  />
                </td>
                <td>
                  <StatusSelect
                    value={e.status}
                    disabled={busyId === e.id}
                    disablePaidArchived={e.payeeId == null}
                    onChange={(status) => {
                      if (status === "paid_archived" && e.payeeId == null) {
                        setLocalError("Assign a payee before marking this entry as Paid.");
                        return;
                      }
                      void patchEntry(e.id, { status });
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
