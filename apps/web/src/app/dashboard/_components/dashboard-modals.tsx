'use client';

import dynamic from 'next/dynamic';
import { ActionDialog } from '../../_components/ActionDialog';
import { PasswordInput } from '../../_components/PasswordInput';

const QRCode = dynamic(() => import('react-qr-code'), { ssr: false });

// ── Two-Factor Setup ─────────────────────────────────────────────────────

type SetupDialogProps = {
  open: boolean;
  openQr: boolean;
  step: 'password' | 'qr';
  password: string;
  setPassword: (v: string) => void;
  error: string;
  setError: (v: string) => void;
  totpURI: string;
  totpCode: string;
  setTotpCode: (v: string) => void;
  backupCodes: string[];
  setStep: (v: 'password' | 'qr') => void;
  onEnable: () => void;
  onVerify: () => void;
  onClose: () => void;
};

export function TwoFactorSetupDialog({
  open,
  openQr,
  step,
  password,
  setPassword,
  error,
  setError,
  totpURI,
  totpCode,
  setTotpCode,
  backupCodes,
  setStep,
  onEnable,
  onVerify,
  onClose,
}: SetupDialogProps) {
  return (
    <>
      <ActionDialog
        open={open && step === 'password'}
        title="Set up Two-Factor Auth"
        description="Enter your password to verify your identity."
        confirmLabel="Continue"
        onConfirm={onEnable}
        onClose={onClose}
      >
        <PasswordInput
          label="Your password"
          placeholder="Your password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError('');
          }}
          className="w-full px-4 py-2.5 bg-background border border-border/60 rounded-xl text-[14px] outline-none focus:border-primary/50"
        />
        {error ? (
          <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}
      </ActionDialog>

      <ActionDialog
        open={openQr && step === 'qr'}
        title="Scan this QR code"
        description="Open your authenticator app, scan the code, then enter the 6-digit code below."
        confirmLabel="Verify & Enable"
        cancelLabel="Cancel"
        onConfirm={onVerify}
        onClose={onClose}
      >
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-lg flex justify-center w-fit mx-auto shadow-sm border border-border/20">
            <QRCode value={totpURI} size={160} />
          </div>
          <input
            type="text"
            aria-label="6-digit verification code"
            placeholder="000000"
            value={totpCode}
            onChange={(e) => {
              setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              if (error) setError('');
            }}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-[18px] outline-none text-center tracking-[0.25em] font-mono"
          />
          {error ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-left text-xs text-red-300">
              {error}
            </p>
          ) : null}

          {backupCodes.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-left">
              <p className="text-[11px] font-bold text-yellow-600 mb-1.5 uppercase">
                Backup Codes (Save all of these)
              </p>
              <p className="mb-2 text-[11px] text-yellow-700 dark:text-yellow-300">
                Store these in a password manager. Each code can only be used
                once.
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {backupCodes.map((c, i) => (
                  <code
                    key={i}
                    className="text-[10px] bg-background/50 border border-border/30 rounded px-1.5 py-0.5 text-center"
                  >
                    {c}
                  </code>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-start pt-1">
            <button
              type="button"
              onClick={() => {
                setStep('password');
                setTotpCode('');
                setError('');
              }}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to password
            </button>
          </div>
        </div>
      </ActionDialog>
    </>
  );
}

// ── Disable Two-Factor ───────────────────────────────────────────────────

type DisableDialogProps = {
  open: boolean;
  password: string;
  setPassword: (v: string) => void;
  error: string;
  setError: (v: string) => void;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function DisableTwoFactorDialog({
  open,
  password,
  setPassword,
  error,
  setError,
  pending,
  onConfirm,
  onClose,
}: DisableDialogProps) {
  return (
    <ActionDialog
      open={open}
      title="Disable two-factor authentication"
      description="Enter your password to remove 2FA protection from this account."
      confirmLabel="Disable 2FA"
      destructive
      pending={pending}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <PasswordInput
        label="Confirm password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          if (error) setError('');
        }}
        placeholder="Confirm password"
        className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
      />
      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
    </ActionDialog>
  );
}

// ── Change Password ──────────────────────────────────────────────────────

type ChangePasswordDialogProps = {
  open: boolean;
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
  setCurrentPassword: (v: string) => void;
  setNewPassword: (v: string) => void;
  setConfirmNewPassword: (v: string) => void;
  error: string;
  setError: (v: string) => void;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
  strength: string;
};

export function ChangePasswordDialog({
  open,
  currentPassword,
  newPassword,
  confirmNewPassword,
  setCurrentPassword,
  setNewPassword,
  setConfirmNewPassword,
  error,
  setError,
  pending,
  onConfirm,
  onClose,
  strength,
}: ChangePasswordDialogProps) {
  return (
    <ActionDialog
      open={open}
      title="Change Password"
      description="Enter your current password and choose a new one."
      confirmLabel="Change Password"
      pending={pending}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <div className="space-y-3">
        <PasswordInput
          label="Current password"
          placeholder="Current password"
          value={currentPassword}
          onChange={(e) => {
            setCurrentPassword(e.target.value);
            if (error) setError('');
          }}
          className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
        />
        <PasswordInput
          label="New password"
          placeholder="New password (min 8 characters)"
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            if (error) setError('');
          }}
          className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
        />
        {newPassword ? (
          <p className="text-xs text-muted-foreground">
            Strength:{' '}
            <span className="font-medium text-foreground">{strength}</span>
          </p>
        ) : null}
        <PasswordInput
          label="Confirm new password"
          placeholder="Confirm new password"
          value={confirmNewPassword}
          onChange={(e) => {
            setConfirmNewPassword(e.target.value);
            if (error) setError('');
          }}
          className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
        />
      </div>
      {error ? (
        <p className="mt-2 text-xs text-red-300">{error}</p>
      ) : null}
    </ActionDialog>
  );
}