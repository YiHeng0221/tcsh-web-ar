import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { InvalidCredentialsError, signIn } from "@/modes/c/lib/auth";

/**
 * C1 · Login (issue #24).
 *
 * Desktop only (1280×800). Card-form auth against the local FastAPI
 * `POST /auth/login` endpoint. Successful login flips `useAuthSession`
 * in ModeCRoot, which routes the user to C2.
 *
 * Validation: react-hook-form + zod. Email shape + non-empty password.
 * The "real" wrong-password feedback comes from the API (401 →
 * `Invalid credentials`), surfaced as a single error line under the form.
 */

const schema = z.object({
  email: z.string().min(1, "請輸入 Email").email("Email 格式不正確"),
  password: z.string().min(1, "請輸入密碼"),
});

type FormValues = z.infer<typeof schema>;

export default function C1Login() {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    try {
      await signIn(values);
      // ModeCRoot picks up the auth state change; no manual nav needed.
    } catch (err) {
      // Discriminate via the typed error so we don't depend on the API's
      // 401 message text (which the backend may localise / rephrase).
      if (err instanceof InvalidCredentialsError) {
        setSubmitError("Email 或密碼錯誤");
        return;
      }
      const message = err instanceof Error ? err.message : "登入失敗";
      setSubmitError(message);
    }
  }

  return (
    <div
      data-mode="c"
      data-screen="c1"
      className="flex min-h-dvh min-w-[1280px] items-center justify-center bg-c-bg px-6 text-c-ink"
    >
      <div className="flex w-full max-w-sm flex-col items-center">
        {/* Logo block */}
        <div
          aria-hidden
          className="h-9 w-9 rounded-md bg-c-ink"
        />
        <h1 className="mt-4 text-[22px] font-semibold tracking-tight">
          tcsh-web-ar Studio
        </h1>

        {/* Card */}
        <form
          noValidate
          onSubmit={handleSubmit(onSubmit)}
          className="mt-7 w-full rounded-2xl border border-c-hairline bg-c-surface p-7 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        >
          <FormField
            id="c1-email"
            label="Email"
            error={errors.email?.message}
          >
            <input
              id="c1-email"
              data-testid="mode-c-login-email"
              type="email"
              autoComplete="email"
              spellCheck={false}
              placeholder="allen@tcsh.art"
              className="h-10 w-full rounded-md border border-c-hairline bg-c-surface px-3 text-sm text-c-ink placeholder:text-c-placeholder focus:border-c-ink focus:outline-none"
              {...register("email")}
            />
          </FormField>

          <FormField
            id="c1-password"
            label="Password"
            className="mt-4"
            error={errors.password?.message}
          >
            <input
              id="c1-password"
              data-testid="mode-c-login-password"
              type="password"
              autoComplete="current-password"
              placeholder="•••••••••"
              className="h-10 w-full rounded-md border border-c-hairline bg-c-surface px-3 text-sm text-c-ink placeholder:text-c-placeholder focus:border-c-ink focus:outline-none"
              {...register("password")}
            />
          </FormField>

          {submitError && (
            <p className="mt-4 text-xs text-danger" role="alert">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            data-testid="mode-c-login-submit"
            disabled={isSubmitting}
            className="mt-6 h-11 w-full rounded-md bg-c-ink text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "登入中…" : "登入"}
          </button>
        </form>

        <p className="mt-5 text-xs text-c-muted">tcsh-ar API · 本地 JWT</p>
      </div>
    </div>
  );
}

function FormField({
  id,
  label,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-c-muted"
      >
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {error && (
        <p className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
