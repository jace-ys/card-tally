/** Display helper — amounts are strings from the API to preserve precision. */
export function formatAmount(amount: string, currency?: string): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return amount;
  const cur = currency?.trim().toUpperCase();
  if (cur && /^[A-Z]{3}$/.test(cur)) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: cur,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      // Fall back to plain numeric formatting below.
    }
  }
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
