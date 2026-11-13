import { useState, useMemo } from "react";

type SortDir = "asc" | "desc";

export function useSort<T extends Record<string, unknown>>(
  rows: T[],
  defaultKey: keyof T,
  defaultDir: SortDir = "desc"
) {
  const [sortKey, setSortKey] = useState<keyof T>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  function handleSort(key: keyof T) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const sample = rows[0]?.[key];
      setSortDir(typeof sample === "number" ? "desc" : "asc");
    }
  }

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const av = a[sortKey] ?? "";
        const bv = b[sortKey] ?? "";
        const cmp =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : typeof av === "boolean" && typeof bv === "boolean"
              ? (av ? 1 : 0) - (bv ? 1 : 0)
              : String(av).localeCompare(String(bv));
        return sortDir === "asc" ? cmp : -cmp;
      }),
    [rows, sortKey, sortDir]
  );

  const indicator = (key: keyof T) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  return { sorted, handleSort, indicator };
}
