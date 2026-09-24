const DECIMAL = /^-?\d+(?:\.\d+)?$/;

export function addDecimal(left: string, right: string): string {
  if (!DECIMAL.test(left) || !DECIMAL.test(right)) {
    throw new Error("Store returned an invalid money amount");
  }
  const places = Math.max(left.split(".")[1]?.length ?? 0, right.split(".")[1]?.length ?? 0);
  const scale = 10n ** BigInt(places);
  const toScaled = (value: string): bigint => {
    const sign = value.startsWith("-") ? -1n : 1n;
    const [whole, fraction = ""] = value.replace("-", "").split(".");
    return sign * (BigInt(whole) * scale + BigInt(fraction.padEnd(places, "0") || "0"));
  };
  const sum = toScaled(left) + toScaled(right);
  const sign = sum < 0n ? "-" : "";
  const abs = sum < 0n ? -sum : sum;
  if (!places) return `${sign}${abs}`;
  const fraction = String(abs % scale).padStart(places, "0").replace(/0+$/, "");
  return `${sign}${abs / scale}${fraction ? `.${fraction}` : ""}`;
}
