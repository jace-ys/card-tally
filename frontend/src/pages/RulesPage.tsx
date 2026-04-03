import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type {
  MerchantRule,
  Payee,
  StatementFormat,
} from "../types/api";
import { ErrorBanner } from "../components/ErrorBanner";
import { PayeeSelect } from "../components/PayeeSelect";

const FORMATS: StatementFormat[] = ["amex", "yonder"];

export function RulesPage() {
  const [rules, setRules] = useState<MerchantRule[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | "__new__" | null>(null);

  const [newFormat, setNewFormat] = useState<StatementFormat>("amex");
  const [newMerchant, setNewMerchant] = useState("");
  const [newPayeeId, setNewPayeeId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [r, p] = await Promise.all([api.listRules(), api.listPayees()]);
      p.sort((a, b) => a.sortOrder - b.sortOrder);
      setRules(r);
      setPayees(p);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    const merchant = newMerchant.trim();
    if (!merchant || !newPayeeId) return;
    setBusyId("__new__");
    try {
      await api.createRule({
        statementFormat: newFormat,
        merchantExact: merchant,
        payeeId: newPayeeId,
      });
      setNewMerchant("");
      setNewPayeeId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusyId(null);
    }
  }

  async function updateRule(rule: MerchantRule, patch: Partial<MerchantRule>) {
    setBusyId(rule.id);
    try {
      await api.updateRule(rule.id, {
        statementFormat: patch.statementFormat,
        merchantExact: patch.merchantExact,
        payeeId: patch.payeeId,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteRule(id: number) {
    if (!confirm("Delete this rule?")) return;
    setBusyId(id);
    try {
      await api.deleteRule(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusyId(null);
    }
  }

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
          <h2 style={{ margin: 0 }}>🧠 Merchant rules</h2>
          <Link className="btn" to="/">
            🧾 Statements
          </Link>
        </div>
        <p className="hint">
          Exact merchant string match per statement format. Applied when
          importing or when the backend reconciles entries.
        </p>

        <form onSubmit={createRule} className="card" style={{ background: "#fafafa" }}>
          <h3 style={{ marginTop: 0 }}>New rule</h3>
          <div className="field">
            <label htmlFor="rule-format">Format</label>
            <select
              id="rule-format"
              value={newFormat}
              onChange={(e) =>
                setNewFormat(e.target.value as StatementFormat)
              }
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rule-merchant">Merchant (exact)</label>
            <input
              id="rule-merchant"
              value={newMerchant}
              onChange={(e) => setNewMerchant(e.target.value)}
              placeholder="SAINSBURY'S             LONDON"
              style={{ maxWidth: "100%", width: "min(480px, 100%)" }}
            />
          </div>
          <div className="field">
            <label>Payee</label>
            <PayeeSelect
              payees={payees}
              value={newPayeeId}
              disabled={busyId === "__new__"}
              onChange={setNewPayeeId}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busyId === "__new__" || !newMerchant.trim() || !newPayeeId}
          >
            Create rule
          </button>
        </form>

        {loading ? (
          <p className="hint">Loading rules…</p>
        ) : rules.length === 0 ? (
          <p className="hint">No rules yet.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: "1rem" }}>
            <table className="rules-table">
              <thead>
                <tr>
                  <th>Format</th>
                  <th>Merchant (exact)</th>
                  <th>Payee</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    payees={payees}
                    busy={busyId === rule.id}
                    onSave={(patch) => void updateRule(rule, patch)}
                    onDelete={() => void deleteRule(rule.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function RuleRow({
  rule,
  payees,
  busy,
  onSave,
  onDelete,
}: {
  rule: MerchantRule;
  payees: Payee[];
  busy: boolean;
  onSave: (patch: Partial<MerchantRule>) => void;
  onDelete: () => void;
}) {
  const [format, setFormat] = useState(rule.statementFormat);
  const [merchant, setMerchant] = useState(rule.merchantExact);
  const [payeeId, setPayeeId] = useState<number | null>(rule.payeeId);

  useEffect(() => {
    setFormat(rule.statementFormat);
    setMerchant(rule.merchantExact);
    setPayeeId(rule.payeeId);
  }, [
    rule.id,
    rule.statementFormat,
    rule.merchantExact,
    rule.payeeId,
  ]);

  const dirty =
    format !== rule.statementFormat ||
    merchant !== rule.merchantExact ||
    payeeId !== rule.payeeId;

  return (
    <tr>
      <td>
        <select
          value={format}
          disabled={busy}
          onChange={(e) => setFormat(e.target.value as StatementFormat)}
        >
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          value={merchant}
          disabled={busy}
          onChange={(e) => setMerchant(e.target.value)}
          style={{ width: "100%", minWidth: "200px" }}
        />
      </td>
      <td>
        <PayeeSelect
          payees={payees}
          value={payeeId}
          disabled={busy}
          onChange={setPayeeId}
        />
      </td>
      <td className="row-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !dirty || !payeeId}
          onClick={() =>
            onSave({
              statementFormat: format,
              merchantExact: merchant.trim(),
              payeeId: payeeId!,
            })
          }
        >
          Save
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onDelete}>
          Delete
        </button>
      </td>
    </tr>
  );
}
