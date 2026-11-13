/// <reference types="vite/client" />

declare module "@dynatrace-sdk/react-hooks" {
  export function useDql(args: { query: string }): {
    data?: { records?: Record<string, unknown>[] };
    isLoading?: boolean;
    error?: unknown;
  };
}
