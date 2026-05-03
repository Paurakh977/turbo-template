"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../../../lib/auth-client";
import { motion, AnimatePresence } from "framer-motion";

type Method = "totp" | "otp" | "backup";

export default function TwoFactorPage() {
  const router = useRouter();
  const [method, setMethod] = useState<Method>("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    let result;

    if (method === "totp") {
      result = await authClient.twoFactor.verifyTotp({ code, trustDevice });
    } else if (method === "otp") {
      result = await authClient.twoFactor.verifyOtp({ code, trustDevice });
    } else {
      result = await authClient.twoFactor.verifyBackupCode({ code, trustDevice });
    }

    if (result.error) {
      setError(result.error.message ?? "Invalid code. Please try again.");
    } else {
      router.push("/dashboard");
    }

    setLoading(false);
  };

  const sendOtp = async () => {
    await authClient.twoFactor.sendOtp();
    alert("OTP sent to your email!");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-sans relative overflow-hidden p-4">
      {/* Ambient background blur */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/5 rounded-[100%] blur-[100px] pointer-events-none opacity-50"></div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 bg-card/80 backdrop-blur-2xl border border-border/50 rounded-[24px] p-8 sm:p-10 w-full max-w-[400px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)]"
      >
        <div className="mb-8 text-center">
          <a href="/" style={{ textDecoration: 'none' }}>
            <motion.div className="w-16 h-16 bg-white border border-border/60 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-sm">
              <img src="/logo.svg" alt="Ozon" className="w-10 h-10 object-contain" />
            </motion.div>
          </a>
          <h1 className="text-2xl font-bold tracking-tight mb-1.5">Two-Step Verification</h1>
          <p className="text-[13px] text-muted-foreground">Verify your identity to continue</p>
        </div>

        {/* Method selector */}
        <div className="flex bg-muted/50 p-1 rounded-xl mb-8 border border-border/40">
          {(["totp", "otp", "backup"] as Method[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMethod(m); setCode(""); setError(""); }}
              className={`flex-1 relative rounded-lg text-[12px] font-medium py-2 transition-colors z-10 ${
                method === m ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {method === m && (
                <motion.div 
                  layoutId="method-active"
                  className="absolute inset-0 bg-background border border-border/40 rounded-lg shadow-sm -z-10"
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                />
              )}
              {m === "totp" ? "App" : m === "otp" ? "Email" : "Backup"}
            </button>
          ))}
        </div>

        <form onSubmit={handleVerify} className="space-y-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={method}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
            >
              {method === "totp" && <p className="text-[13px] text-center text-muted-foreground mb-4">Enter the 6-digit code from your authenticator app</p>}
              {method === "otp" && (
                <div className="text-center mb-4">
                  <p className="text-[13px] text-muted-foreground mb-3">Enter the code sent to your email</p>
                  <button type="button" onClick={sendOtp} className="text-xs bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-md font-medium transition-colors border border-border/50">
                    Send OTP
                  </button>
                </div>
              )}
              {method === "backup" && <p className="text-[13px] text-center text-muted-foreground mb-4">Enter one of your saved backup codes</p>}
            </motion.div>
          </AnimatePresence>

          <input
            className="w-full px-4 py-3.5 bg-background/50 border border-border/60 rounded-xl text-[18px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all text-center tracking-[0.25em] font-mono placeholder:tracking-normal placeholder:font-sans placeholder:text-muted-foreground/50"
            type="text"
            placeholder={method === "backup" ? "Backup code" : "000000"}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={method === "backup" ? 20 : 6}
            required
            autoComplete="one-time-code"
          />

          <label className="flex items-center gap-2.5 text-[13px] text-muted-foreground cursor-pointer justify-center mt-4">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              className="rounded border-border bg-background text-primary focus:ring-primary/20 w-4 h-4"
            />
            <span>Trust this device for 30 days</span>
          </label>

          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <p className="text-red-500 text-xs text-center bg-red-500/10 p-2 rounded-lg border border-red-500/20">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 mt-2 bg-primary text-primary-foreground rounded-xl text-[14px] font-semibold hover:bg-primary/90 transition-all disabled:opacity-70 flex justify-center items-center shadow-sm"
          >
            {loading ? <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></span> : "Verify"}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
