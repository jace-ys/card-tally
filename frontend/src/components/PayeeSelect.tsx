import type { Payee } from "../types/api";

export function PayeeSelect({
  payees,
  value,
  onChange,
  disabled,
}: {
  payees: Payee[];
  value: number | null;
  onChange: (payeeId: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value == null ? "" : String(value)}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : Number(v));
      }}
      aria-label="Payee"
    >
      <option value="">— Unassigned —</option>
      {payees.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
