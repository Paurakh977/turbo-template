// app/auth/reset-password/page.tsx
"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "../../../lib/auth-client";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!token) {
      setError("Invalid or missing reset token.");
      return;
    }

    setLoading(true);
    setError("");

    const { error } = await authClient.resetPassword({
      newPassword: password,
      token,
    });

    if (error) {
      setError(error.message ?? "Reset failed.");
    } else {
      alert("Password set! You can now sign in.");
      router.push("/auth");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-sans relative overflow-hidden p-4">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/5 rounded-[100%] blur-[100px] pointer-events-none opacity-50"></div>

      <div className="relative z-10 bg-card/80 backdrop-blur-2xl border border-border/50 rounded-[24px] p-8 sm:p-10 w-full max-w-[420px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)]">
        <div className="mb-8 text-center">
          <a href="/" style={{ textDecoration: 'none' }}>
            <div className="w-12 h-12 bg-white border border-border/60 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-sm">
              <img src="/logo.svg" alt="Ozon" className="w-8 h-8 object-contain" />
            </div>
          </a>
          <h2 className="text-2xl font-bold tracking-tight mb-2">Set Your Password</h2>
          <p className="text-[13px] text-muted-foreground">
            Create a password to enable two-factor authentication on your account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <input
            type="password"
            placeholder="New password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            className="w-full px-4 py-3 bg-background/50 border border-border/60 rounded-xl text-[14px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/70"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className="w-full px-4 py-3 bg-background/50 border border-border/60 rounded-xl text-[14px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/70"
          />

          {error && (
            <p className="text-red-500 text-xs bg-red-500/10 p-2.5 rounded-lg border border-red-500/20">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-[14px] font-semibold hover:bg-primary/90 transition-all disabled:opacity-70 flex justify-center items-center shadow-sm"
          >
            {loading ? <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></span> : "Set Password"}
          </button>
        </form>

        <div className="mt-8 text-center">
          <a href="/auth" className="text-[13px] text-muted-foreground hover:text-foreground font-medium transition-colors">
            â† Back to sign in
          </a>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
