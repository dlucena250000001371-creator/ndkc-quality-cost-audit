import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let message = 'Something went wrong while loading this page.';
    try {
      const parsed = JSON.parse(error.message) as { error?: string; path?: string };
      if (parsed && parsed.error) {
        message = `Database access error${parsed.path ? ` (${parsed.path})` : ''}: ${parsed.error}`;
      }
    } catch {
      if (error.message) message = error.message;
    }
    return { hasError: true, message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F1F5F9] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-[#E2E8F0] rounded-2xl p-6 space-y-4">
            <h1 className="text-xl font-bold text-slate-900">Unable to display this view</h1>
            <p className="text-sm text-slate-600">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-[#1E40AF] text-white text-sm font-semibold rounded-xl hover:bg-blue-900 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
