"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { makeQueryClient } from "@/config/query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  // useState initializer so the client is created once per browser session,
  // not on every render. Defaults come from the shared factory.
  const [queryClient] = useState(() => makeQueryClient());
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
