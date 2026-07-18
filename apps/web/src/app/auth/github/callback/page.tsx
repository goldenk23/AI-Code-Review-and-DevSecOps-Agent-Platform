// Server Component. Reads `searchParams` (a Promise in Next 16) and passes
// the code down to a Client child that handles the UX / fetch.
import { AuthCallbackClient } from "./AuthCallbackClient";

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const code = typeof sp.code === "string" ? sp.code : "";
  return <AuthCallbackClient code={code} />;
}