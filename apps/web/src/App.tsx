import { SessionProvider } from "./app/session";
import AppShell from "./app/AppShell";
import { ErrorBoundary } from "./app/ErrorBoundary";
export default function App() {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <AppShell />
      </SessionProvider>
    </ErrorBoundary>
  );
}
