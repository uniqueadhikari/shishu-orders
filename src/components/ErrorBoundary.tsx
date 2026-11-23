import React from 'react';
import { getUserFriendlyError } from '../firebase/errors';

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

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: getUserFriendlyError(error, 'An unexpected error occurred in the application.'),
    };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('Application ErrorBoundary:', error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#E6E2D8] rounded-2xl p-8 text-center">
            <p className="font-display text-2xl font-semibold tracking-tight text-[#121211]">
              SHISHU.CLO
            </p>
            <h1 className="mt-4 text-lg font-semibold text-[#121211]">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-[#5C5852] leading-relaxed">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 w-full min-h-[44px] px-5 py-2.5 rounded-xl bg-[#121211] text-[#F7F5F0] text-sm font-medium hover:bg-[#272624] transition-colors cursor-pointer"
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
