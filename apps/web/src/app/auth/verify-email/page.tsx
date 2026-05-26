'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '../../../lib/auth-client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getVerifyEmailCallbackError,
  getVerifyEmailPublicError,
} from '../../../lib/auth-errors';

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(
    'loading',
  );
  const [message, setMessage] = useState('');

  useEffect(() => {
    let isMounted = true;
    const token = searchParams.get('token');
    const callbackError = getVerifyEmailCallbackError(
      searchParams.get('error'),
    );

    if (callbackError) {
      setStatus('error');
      setMessage(callbackError);
      return;
    }

    if (!token) {
      setStatus('error');
      setMessage('Invalid verification link. Please request a new one.');
      return;
    }

    authClient
      .verifyEmail({
        query: { token },
      })
      .then(({ error }) => {
        if (!isMounted) return;
        if (error) {
          setStatus('error');
          setMessage(getVerifyEmailPublicError(error));
          return;
        }

        setStatus('success');
        window.setTimeout(() => {
          router.push('/dashboard');
        }, 1200);
      })
      .catch(() => {
        if (!isMounted) return;
        setStatus('error');
        setMessage('Unable to verify email right now. Please try again.');
      });

    return () => {
      isMounted = false;
    };
  }, [router, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-sans relative overflow-hidden p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 bg-card border border-border/50 rounded-xl p-10 w-full max-w-[420px] shadow-sm text-center"
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
              <Link href="/" className="inline-block no-underline">
                <div className="w-20 h-20 bg-white border border-border/60 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                  <img
                    src="/logo.svg"
                    alt="Ozon"
                    className="w-12 h-12 object-contain"
                  />
                </div>
              </Link>
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
              <Link href="/" className="inline-block no-underline">
                <div className="w-20 h-20 bg-white border border-border/60 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                  <img
                    src="/logo.svg"
                    alt="Ozon"
                    className="w-12 h-12 object-contain"
                  />
                </div>
              </Link>
              <h2 className="text-xl font-bold tracking-tight">
                Verification failed
              </h2>
              <p className="text-muted-foreground text-sm mt-2 mb-8 leading-relaxed">
                {message}
              </p>
              <Link
                href="/auth"
                className="inline-block w-full py-2.5 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-xl text-sm font-medium transition-all border border-border/50"
              >
                Back to sign in
              </Link>
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
