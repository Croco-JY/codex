/** Exact, non-negative domain decimals: at most 15 integer and 4 fractional digits. */
export function decimal(value: string): string | undefined {
  if (!/^\d+(?:\.\d{1,4})?$/.test(value)) return;
  const [whole = "", fraction = ""] = value.split(".");
  const integer = whole.replace(/^0+(?=\d)/, "");
  if (integer.length > 15) return;
  const tail = fraction.replace(/0+$/, "");
  return tail ? `${integer}.${tail}` : integer;
}
export function compareDecimal(left: string, right: string): number {
  const scaled = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(`${whole}${fraction.padEnd(4, "0")}`);
  };
  const a = scaled(left),
    b = scaled(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
