/**
 * Format a number into the Indian numbering system (Crores/Lakhs).
 * - >= 1 Crore (10,000,000) -> e.g. "2.5 Crore"
 * - < 1 Crore -> e.g. "80 Lakhs"
 */
export function formatIndianAmount(amount: number): string {
  const LAKH = 100_000;
  const CRORE = 10_000_000;

  if (amount >= CRORE) {
    const cr = amount / CRORE;
    return `\u20b9${cr % 1 === 0 ? cr.toFixed(0) : cr.toFixed(2)} Crore`;
  }
  const lk = amount / LAKH;
  return `\u20b9${lk % 1 === 0 ? lk.toFixed(0) : lk.toFixed(1)} Lakhs`;
}
