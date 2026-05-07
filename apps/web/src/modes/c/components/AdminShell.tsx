import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { cn } from "@/lib/cn";
import { useAuthSession } from "@/modes/c/lib/auth";

/**
 * AdminShell — shared top nav for C2-C6.
 *
 * Two visual variants:
 *   - "default" (C2 dashboard): logo left, email + 登出 right.
 *   - "back" (C3-C6 sub-screens): back button + title left, optional `actions`
 *     slot right (e.g. "+ 上傳新貼圖" on C3).
 *
 * Layout philosophy: the shell owns the 56px sticky top bar and a content
 * container, but stays out of the way otherwise. C5/C6 may need a wider
 * full-bleed canvas — pass `contentClassName="px-0"` and they can manage
 * their own padding.
 */
export type AdminShellProps = {
  /** Header variant. `default` = logo + user. `back` = back button + title. */
  variant?: "default" | "back";
  /** Title shown in `back` variant. Ignored for `default`. */
  title?: string;
  /** When variant === "back", optional onClick override; defaults to navigate(-1). */
  onBack?: () => void;
  /** Right-hand slot (C3 upload button, C5 publish button, etc.). */
  actions?: ReactNode;
  /** Page body. */
  children: ReactNode;
  /** Override content container classes (e.g. C3's wider grid). */
  contentClassName?: string;
};

export default function AdminShell({
  variant = "default",
  title,
  onBack,
  actions,
  children,
  contentClassName,
}: AdminShellProps) {
  return (
    <div
      data-mode="c"
      className="min-h-dvh bg-c-bg text-c-ink"
      style={{ minWidth: 1280 }}
    >
      <AdminTopNav
        variant={variant}
        title={title}
        onBack={onBack}
        actions={actions}
      />
      <main className={cn("mx-auto w-full max-w-[1200px] px-10 py-8", contentClassName)}>
        {children}
      </main>
    </div>
  );
}

/** Internal — exported only via AdminShell's variants. */
function AdminTopNav({
  variant,
  title,
  onBack,
  actions,
}: {
  variant: "default" | "back";
  title?: string;
  onBack?: () => void;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();
  const { email, signOut } = useAuthSession();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  function handleBack() {
    if (onBack) {
      onBack();
      return;
    }
    if (window.history.length > 1) navigate(-1);
    else navigate(`/_studio/${token ?? ""}`, { replace: true });
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-c-hairline bg-c-surface px-8">
      <div className="flex items-center gap-3">
        {variant === "back" ? (
          <>
            <button
              type="button"
              onClick={handleBack}
              className="flex h-9 w-9 items-center justify-center rounded-md text-[18px] leading-none text-c-ink hover:bg-c-hover"
              aria-label="返回"
            >
              ‹
            </button>
            <h1 className="text-base font-medium">{title}</h1>
          </>
        ) : (
          <span className="text-[15px] font-semibold tracking-tight">
            tcsh-web-ar Studio
          </span>
        )}
      </div>

      <div className="flex items-center gap-5">
        {actions}
        {variant === "default" && (
          <>
            <span className="text-sm text-c-muted">{email ?? ""}</span>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="text-sm text-c-ink hover:text-c-ink-soft disabled:opacity-50"
            >
              {signingOut ? "登出中…" : "登出"}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
