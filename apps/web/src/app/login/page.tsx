// Server Component. The Stitch auth SPEC says this page is full-viewport
// with NO nav bar, so we don't wrap it in <AppShell/>. We just hand off to
// the client <LoginScreen> component which owns the card layout.
import { LoginScreen } from "@/components/login-screen";

export default function LoginPage() {
  return <LoginScreen />;
}