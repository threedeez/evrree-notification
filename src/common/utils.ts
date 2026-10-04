export function cleanObject<T>(obj: Partial<T>): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([v]) => v != null && v !== ""),
  ) as T;
}
