// Server Component. Reads `searchParams` (a Promise in Next 16) and passes
// the OAuth `code` down to the Client child. Centralizing the searchParam
// parsing here keeps the client free of `useSearchParams()` (which would
// force a Suspense boundary / CSR-deopt in Next 16).
import { AuthCallbackClient } from "./AuthCallbackClient";

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const code = typeof sp.code === "string" ? sp.code : "";
  return <AuthCallbackClient code={code} nextPath="/" />;
}