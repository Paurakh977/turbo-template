'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '../../../lib/auth-client';
import { motion, AnimatePresence } from 'framer-motion';

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(
    'loading',
  );
  const [message, setMessage] = useState('');

  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      if (data?.session) {
        setStatus('success');
        setTimeout(() => router.push('/dashboard'), 2000);
      } else {
        setStatus('error');
        setMessage(
          'Verification link may have expired. Please request a new one.',
        );
      }
    });
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-sans relative overflow-hidden p-4">
      <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,var(--primary)/0.03_0,transparent_100%)]"></div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 bg-card/80 backdrop-blur-xl border border-border/50 rounded-[24px] p-10 w-full max-w-[400px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)] text-center"
      >
        <AnimatePresence mode="wait">
          {status === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-6"></div>
              <h2 className="text-xl font-semibold tracking-tight">
                Verifying your email...
              </h2>
              <p className="text-muted-foreground text-sm mt-2">
                Just a moment please
              </p>
            </motion.div>
          )}

          {status === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring' }}
            >
              <a href="/" style={{ textDecoration: 'none' }}>
                <div className="w-20 h-20 bg-white border border-border/60 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                  <img
                    src="/logo.svg"
                    alt="Ozon"
                    className="w-12 h-12 object-contain"
                  />
                </div>
              </a>
              <h2 className="text-xl font-bold tracking-tight">
                Email verified!
              </h2>
              <p className="text-muted-foreground text-sm mt-2">
                Redirecting you to the dashboard...
              </p>
            </motion.div>
          )}

          {status === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring' }}
            >
              <a href="/" style={{ textDecoration: 'none' }}>
                <div className="w-20 h-20 bg-white border border-border/60 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                  <img
                    src="/logo.svg"
                    alt="Ozon"
                    className="w-12 h-12 object-contain"
                  />
                </div>
              </a>
              <h2 className="text-xl font-bold tracking-tight">
                Verification failed
              </h2>
              <p className="text-muted-foreground text-sm mt-2 mb-8 leading-relaxed">
                {message}
              </p>
              <a
                href="/auth"
                className="inline-block w-full py-2.5 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-xl text-sm font-medium transition-all border border-border/50"
              >
                Back to sign in
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
