import React from 'react';

interface State {
  error: Error | null;
}

/** Last line of defense: a render crash shows a friendly screen instead of a blank window. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Aestheticy UI crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#07080D] text-white p-8">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-white/60">
            Aestheticy hit an unexpected problem. Your library and settings are safe.
          </p>
          <p className="text-xs text-white/40 font-mono break-words">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-sm font-semibold cursor-pointer"
          >
            Reload Aestheticy
          </button>
        </div>
      </div>
    );
  }
}
