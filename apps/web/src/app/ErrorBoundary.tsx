import { Component, type ReactNode } from "react";
import { Button } from "../ui";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="error" role="alert">
        <h1>Unable to display this page</h1>
        <p>Reload the application to recover.</p>
        <Button onClick={() => window.location.reload()}>
          Reload application
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
