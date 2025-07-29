"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="max-w-md w-full text-center">
            <AlertTriangle className="h-12 w-12 text-error mx-auto mb-4" />
            <h1 className="text-2xl font-semibold mb-2">Something went wrong</h1>
            <p className="text-text-secondary mb-4">
              An unexpected error occurred. Please try refreshing the page.
            </p>
            {this.state.error && (
              <details className="mb-4 p-4 bg-surface rounded-lg text-left">
                <summary className="cursor-pointer text-sm font-medium">
                  Error details
                </summary>
                <pre className="mt-2 text-xs text-text-secondary overflow-auto">
                  {this.state.error.message}
                </pre>
              </details>
            )}
            <Button onClick={() => window.location.reload()}>
              Refresh Page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}