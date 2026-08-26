import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-cyber-bg flex items-center justify-center p-8 font-[family-name:var(--font-family-mono)]">
          <div className="border border-cyber-danger/30 bg-cyber-bg/90 p-8 max-w-lg w-full">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-cyber-danger/20">
              <span className="text-cyber-danger text-lg animate-pulse">
                █
              </span>
              <h1 className="text-cyber-danger text-xl tracking-wider uppercase">
                RUNTIME ERROR
              </h1>
            </div>

            {/* Error message */}
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <span className="text-cyber-cyan mt-1 shrink-0">
                  [{">"}]
                </span>
                <p className="text-cyber-danger">
                  {this.state.error?.message || "An unexpected error occurred."}
                </p>
              </div>
            </div>

            {/* Reload hint */}
            <div className="mt-6 pt-4 border-t border-cyber-danger/10">
              <button
                onClick={() => window.location.reload()}
                className="text-cyber-cyan text-sm border border-cyber-cyan/30 px-4 py-2 hover:bg-cyber-cyan/10 transition-colors cursor-pointer tracking-wider uppercase"
              >
                [ RELOAD SYSTEM ]
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
