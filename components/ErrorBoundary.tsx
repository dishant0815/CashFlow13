"use client";

// Generic React error boundary. Catches render-time errors in any descendant.
// On error, renders a graceful fallback panel (same visual language as the
// dashboard) and exposes a "Reset" button that calls the parent's
// `onReset` so the dashboard can drop back to a safe empty state.
//
// For *async* errors inside event handlers / fetch / setState callbacks
// React error boundaries do NOT trigger automatically — those go through
// the toast pathway in Dashboard.tsx (see catchAndToast helper).

import { Component } from "react";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  onReset?: () => void;
  fallbackTitle?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="glass rounded-2xl p-8 text-center max-w-2xl mx-auto my-12">
          <AlertTriangle className="w-12 h-12 mx-auto text-coral mb-3" />
          <h2 className="text-white font-bold text-xl">
            {this.props.fallbackTitle ?? "Something went sideways"}
          </h2>
          <p className="text-sm text-slate-400 mt-2">
            We caught an error rendering the dashboard. Your data is safe — the
            forecast just couldn't draw.
          </p>
          <pre className="text-xs text-coral/80 mt-4 px-3 py-2 rounded-lg bg-coral/5 border border-coral/20 text-left overflow-auto max-h-32">
            {this.state.error.message}
          </pre>
          <button
            onClick={this.reset}
            className="mt-5 btn-primary rounded-full px-5 py-2 text-sm font-semibold"
          >
            Reset to safe state
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
