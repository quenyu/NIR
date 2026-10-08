export function formatFixed(value: number, digits = 4): string {
  if (!Number.isFinite(value)) {
    return "н/д";
  }
  return value.toFixed(digits);
}

export function formatScientific(value: number): string {
  if (!Number.isFinite(value)) {
    return "н/д";
  }
  return value.toExponential(3);
}

export function formatCompact(value: number, digits = 3): string {
  if (!Number.isFinite(value)) {
    return "н/д";
  }
  if (value === 0) {
    return "0";
  }
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) {
    return value.toExponential(digits);
  }
  return value.toFixed(digits);
}

export function formatDtTick(value: number): string {
  return value >= 0.1 ? value.toFixed(1) : value.toString();
}
