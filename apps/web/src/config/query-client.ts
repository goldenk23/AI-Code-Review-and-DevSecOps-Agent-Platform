// Shared QueryClient factory. Keeping it in a separate module means the
// same defaults apply whether the client is created in providers.tsx (browser)
// or in a test / SSR prefetch pass. Defaults are tuned for a live dashboard:
//   - staleTime 5s: list data is fresh enough that a tab switch doesn't
//     refetch, but short enough that manual refetch + polling stay useful.
//   - retry 1: one retry on transient network blips, then surface the error
//     (we don't want infinite spinners when the API is genuinely down).
//   - refetchOnWindowFocus: re-validate when the user returns to the tab so
//     stale "running" states don't linger.
import { QueryClient } from "@tanstack/react-query";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}