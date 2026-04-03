import type { Payee } from "../types/api";
import type { CSSProperties } from "react";

export function PayeeSelect({
  payees,
  value,
  onChange,
  disabled,
  className,
  style,
}: {
  payees: Payee[];
  value: number | null;
  onChange: (payeeId: number | null) => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <select
      value={value == null ? "" : String(value)}
      disabled={disabled}
      className={className}
      style={style}
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
