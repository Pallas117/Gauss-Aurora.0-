/**
 * Catches React render errors and reports them to the failure pipeline,
 * then shows a simple fallback UI instead of a blank screen.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportFailure } from "@/lib/failure-reporting";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportFailure({
      type: "crash",
      message: error.message,
      stack: error.stack ?? undefined,
      page: typeof location !== "undefined" ? location.href : undefined,
      payload: { componentStack: info.componentStack ?? undefined },
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-6 text-center text-sm text-foreground"
          role="alert"
        >
          <p className="font-medium">Something went wrong.</p>
          <p className="text-muted-foreground">A report was sent to the team so we can improve.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
