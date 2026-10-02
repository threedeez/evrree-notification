export function cleanObject<T>(obj: Partial<T>): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v != null && v !== ""),
  ) as T;
}
