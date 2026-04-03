import type { EntryStatus } from "../types/api";

const OPTIONS: { value: EntryStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "deferred", label: "Deferred" },
  { value: "paid_archived", label: "Paid (archived)" },
];

export function StatusSelect({
  value,
  onChange,
  disabled,
  disablePaidArchived,
}: {
  value: EntryStatus;
  onChange: (v: EntryStatus) => void;
  disabled?: boolean;
  disablePaidArchived?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as EntryStatus)}
      aria-label="Entry status"
    >
      {OPTIONS.map((o) => (
        <option
          key={o.value}
          value={o.value}
          disabled={disablePaidArchived && o.value === "paid_archived"}
        >
          {o.label}
        </option>
      ))}
    </select>
  );
}
