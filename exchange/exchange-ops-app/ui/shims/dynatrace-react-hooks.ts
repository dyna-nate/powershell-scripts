/**
 * Shim for @dynatrace-sdk/react-hooks.
 * In AppEngine, replace this module via package alias or remove and import the real SDK.
 * Locally returns empty results so the UI uses demo data.
 */
export function useDql(_args: { query: string }): {
  data?: { records?: Record<string, unknown>[] };
  isLoading?: boolean;
  error?: unknown;
  forceRefetch?: () => Promise<void>;
} {
  return { data: { records: [] }, isLoading: false, error: undefined, forceRefetch: async () => {} };
}
