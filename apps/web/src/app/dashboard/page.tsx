"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../../lib/auth-client";
import QRCode from "react-qr-code";
import React from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending, error: sessionError } = authClient.useSession();

  // 2FA setup state
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [totpURI, setTotpURI] = useState("");
  const [backupCodes, setBackupCodes] = useState<any>([]);
  const [totpCode, setTotpCode] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupStep, setSetupStep] = useState<"password" | "qr" | "done">("password");

  // Account listing (used to detect whether a user has a local password/credential)
  const [userAccounts, setUserAccounts] = useState<any>([]);
  const [hasFetchedAccounts, setHasFetchedAccounts] = useState(false);

  useEffect(() => {
    if (session?.user?.id && !isPending && !hasFetchedAccounts) {
      setHasFetchedAccounts(true);
      authClient.listAccounts().then((response: any) => {
        setUserAccounts(response.data ?? []);
      }).catch(() => {
        setHasFetchedAccounts(false);
      });
    }
  }, [session?.user?.id, isPending, hasFetchedAccounts]);

  const hasPasswordAccount = userAccounts ? userAccounts.find((acc: any) => acc.providerId === "credential") : false;

  useEffect(() => {
    if (!isPending && !session && sessionError?.status !== 429) {
      router.push("/auth");
    }
  }, [session, isPending, router, sessionError]);

  if (isPending) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
    </div>
  );
  if (!session && sessionError?.status === 429) return (
    <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-sm">
      Rate limited. Please wait a moment...
    </div>
  );
  if (!session) return null;

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/auth");
  };

  const handleEnable2FA = async () => {
    const { data, error } = await authClient.twoFactor.enable({ password: setupPassword });
    if (error) {
      alert(error.message);
      return;
    }
    if (data) {
      setTotpURI(data.totpURI);
      setBackupCodes(data.backupCodes);
      setSetupStep("qr");
    }
  };

  const handleVerify2FA = async () => {
    const { error } = await authClient.twoFactor.verifyTotp({ code: totpCode });
    if (error) {
      alert("Invalid code, try again");
    } else {
      setSetupStep("done");
      setShow2FASetup(false);
      alert("2FA enabled successfully!");
    }
  };

  const handleDisable2FA = async () => {
    const password = prompt("Enter your password to disable 2FA:");
    if (!password) return;
    const { error } = await authClient.twoFactor.disable({ password });
    if (error) alert(error.message);
    else alert("2FA disabled.");
  };

  const handleSetPassword = async () => {
    if (!session?.user?.email) return;
    const { error } = await authClient.requestPasswordReset({
      email: session.user.email,
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password`,
    });
    if (error) {
      alert(error.message ?? "Failed to send reset email.");
    } else {
      alert(`A password setup link has been sent to ${session.user.email}. Check your inbox!`);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };
  
  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/40">
        <div className="max-w-[760px] mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 text-foreground no-underline">
            <div className="w-9 h-9 border border-border/80 bg-white rounded-xl flex items-center justify-center shadow-sm">
              <img src="/logo.svg" alt="Ozon" className="w-6 h-6 object-contain" />
            </div>
            <span className="font-bold text-[17px] tracking-tight">Ozon</span>
          </a>
          <button 
            onClick={handleSignOut}
            className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors py-1.5 px-3 hover:bg-secondary/60 rounded-md"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-[760px] w-full mx-auto px-6 py-12">
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
          
          <motion.div variants={itemVariants}>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Account Dashboard</h1>
            <p className="text-muted-foreground text-[14px]">Manage your account settings and security preferences.</p>
          </motion.div>

          {/* Profile Card */}
          <motion.div variants={itemVariants} className="bg-card border border-border/50 rounded-[20px] p-6 sm:p-8 flex items-center gap-5 sm:gap-6 shadow-sm">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 rounded-full blur-[20px] scale-150"></div>
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden border border-border/40 relative z-10 bg-secondary flex items-center justify-center text-2xl font-bold text-foreground/50 shadow-inner">
                {session.user.image ? (
                  <img src={session.user.image} alt="avatar" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                ) : (
                  <span>{(session.user.name ?? session.user.email)[0].toUpperCase()}</span>
                )}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl sm:text-2xl font-semibold truncate mb-1">{session.user.name}</h2>
              <p className="text-muted-foreground text-[14px] truncate mb-2">{session.user.email}</p>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide uppercase ${session.user.emailVerified ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-yellow-500/10 text-yellow-600 border border-yellow-500/20'}`}>
                  {session.user.emailVerified ? "Verified" : "Unverified"}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Security Card */}
          <motion.div variants={itemVariants} className="bg-card border border-border/50 rounded-[20px] p-6 sm:p-8 shadow-sm">
            <h3 className="text-[15px] font-semibold flex items-center gap-2 mb-6">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              Security Settings
            </h3>

            {!hasPasswordAccount && hasFetchedAccounts ? (
              <div className="bg-secondary/50 border border-border/50 rounded-xl p-5 text-[13px] text-muted-foreground leading-relaxed">
                You signed in with <strong className="text-foreground">{userAccounts[0]?.providerId === "google" ? "Google" : "GitHub"}</strong>. 
                Two-factor authentication is managed by your social provider.
                To enable app-level 2FA, first <button onClick={handleSetPassword} className="text-primary hover:underline font-medium focus:outline-none">set a password</button> for your account.
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-3 border-b border-border/40 last:border-0 last:pb-0">
                <div>
                  <p className="text-[14px] font-medium text-foreground mb-1">Two-Factor Authentication</p>
                  <p className="text-[13px] text-muted-foreground">
                    {(session.user as any).twoFactorEnabled ? "Adds an extra layer of security to your account." : "Not currently enabled on your account."}
                  </p>
                </div>
                {(session.user as any).twoFactorEnabled ? (
                  <button onClick={handleDisable2FA} className="whitespace-nowrap px-4 py-2 border border-red-500/30 text-red-500 bg-red-500/5 hover:bg-red-500/10 rounded-lg text-[13px] font-medium transition-colors">
                    Disable 2FA
                  </button>
                ) : (
                  <button onClick={() => setShow2FASetup(true)} className="whitespace-nowrap px-4 py-2 bg-foreground text-background hover:bg-foreground/90 rounded-lg text-[13px] font-medium transition-colors shadow-sm">
                    Enable 2FA
                  </button>
                )}
              </div>
            )}
          </motion.div>

        </motion.div>
      </main>

      {/* 2FA Setup Modal */}
      <AnimatePresence>
        {show2FASetup && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-card border border-border/50 rounded-[24px] p-6 sm:p-8 w-full max-w-[440px] shadow-2xl relative"
            >
              <button onClick={() => setShow2FASetup(false)} className="absolute top-5 right-5 text-muted-foreground hover:text-foreground">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>

              <h3 className="text-xl font-bold mb-6 pr-8">Set up Two-Factor Authentication</h3>

              {setupStep === "password" && (
                <div className="space-y-4">
                  <p className="text-[13px] text-muted-foreground">Enter your password to verify it's you before proceeding.</p>
                  <input
                    type="password"
                    placeholder="Your password"
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    className="w-full px-4 py-2.5 bg-background border border-border/60 rounded-xl text-[14px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                  />
                  <div className="flex gap-3 pt-2">
                    <button onClick={handleEnable2FA} className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl text-[13px] font-semibold hover:bg-primary/90 transition-all">
                      Continue
                    </button>
                    <button onClick={() => setShow2FASetup(false)} className="flex-1 py-2.5 bg-secondary text-secondary-foreground rounded-xl text-[13px] font-medium hover:bg-secondary/80 transition-all border border-border/40">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {setupStep === "qr" && (
                <div className="space-y-5">
                  <div>
                    <p className="text-[13px] font-medium mb-1">1. Scan QR Code</p>
                    <p className="text-[12px] text-muted-foreground mb-4">Use Google Authenticator, Authy, or any standard TOTP app.</p>
                    <div className="bg-white p-4 rounded-2xl flex justify-center w-fit mx-auto shadow-sm border border-border/20">
                      <QRCode value={totpURI} size={160} />
                    </div>
                  </div>

                  <div>
                    <p className="text-[13px] font-medium mb-2">2. Enter 6-digit code</p>
                    <input
                      type="text"
                      placeholder="000000"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      maxLength={6}
                      className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-[18px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all text-center tracking-[0.25em] font-mono placeholder:tracking-normal placeholder:font-sans placeholder:text-muted-foreground/50"
                    />
                  </div>

                  {backupCodes.length > 0 && (
                    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 mt-2">
                      <p className="text-[12px] font-semibold text-yellow-600 mb-2 flex items-center gap-1.5">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                        Save these backup codes
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {backupCodes.map((code: any, i: any) => (
                          <code key={i} className="bg-background/80 border border-border/40 rounded py-1 px-2 text-[11px] font-mono text-center text-foreground/80">{code}</code>
                        ))}
                      </div>
                    </div>
                  )}

                  <button onClick={handleVerify2FA} className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-[14px] font-semibold hover:bg-primary/90 transition-all mt-2">
                    Verify & Enable
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}