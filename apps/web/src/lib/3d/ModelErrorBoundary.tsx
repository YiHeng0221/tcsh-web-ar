import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  onRetry?: () => void;
};

type State = {
  error: Error | null;
};

/**
 * Catches glTF load failures (network errors, 404s, malformed bytes) so
 * `<Suspense fallback={null}>` doesn't silently hang on a black screen.
 * Renders a DOM-space message + retry control; since this wraps the
 * `<Canvas>`, it can render regular HTML (no R3F primitives).
 */
export class ModelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Surface in dev; prod wire-up is #33 (Sentry / similar) territory.
    console.error("ModelErrorBoundary caught:", error);
  }

  handleRetry = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="safe-area flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center"
        >
          <p className="text-base font-medium text-fg">3D 模型載入失敗</p>
          <p className="max-w-xs text-xs text-muted">
            {this.state.error.message || "請檢查網路連線後再試一次。"}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            data-testid="mode-b-model-retry"
            className="mt-2 rounded-full border border-white/30 bg-white/10 px-6 py-2 text-sm text-fg backdrop-blur-md"
          >
            重試
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
