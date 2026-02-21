export function normalizeInput(input: string): string {
  return input.normalize("NFKC").replace(/,/g, "").replace(/￥/g, "¥").trim();
}
