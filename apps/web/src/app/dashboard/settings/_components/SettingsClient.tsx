'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  updateDisplayNameAction,
  runLabsSettingAction,
  toggleThemePreferenceAction,
  deleteAccountAction,
} from '../actions';
import { ActionDialog } from '../../../_components/ActionDialog';
import { type ToastKind } from '../../../_components/ToastRegion';
import { PasswordInput } from '../../../_components/PasswordInput';
import { getRoleBadgeStyle } from '../../../../lib/role-badge';
import { useToast } from '../../../../lib/toast-context';
import { applyTheme, resolveThemeFromBrowser } from '../../../../lib/theme';

type UserProps = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: string;
};

type SettingsPerms = {
  canManageProfile: boolean;
  canManageTheme: boolean;
  canManageLabs: boolean;
};

type ToastApi = {
  pushToast: (kind: ToastKind, message: string) => void;
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm transition-all hover:shadow-md dark:bg-white/[0.01] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] dark:hover:border-border/80 dark:hover:shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
      <div className="mb-5 border-b border-border/40 pb-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-[13px] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function FieldRow({
  label,
  value,
  action,
}: {
  label: string;
  value: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        <div className="mt-1 text-[13px] text-muted-foreground">{value}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function ProfileSection({
  user,
  canManageProfile,
  toastApi,
}: {
  user: UserProps;
  canManageProfile: boolean;
  toastApi: ToastApi;
}) {
  const [editing, setEditing] = useState(false);
  const [inlineError, setInlineError] = useState('');
  const [isPending, start] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (!canManageProfile) return;
    setInlineError('');

    const nextName = (nameRef.current?.value ?? '').trim();
    if (!nextName) {
      setInlineError('Name is required.');
      return;
    }

    const fd = new FormData();
    fd.append('name', nextName);

    start(async () => {
      try {
        const res = await updateDisplayNameAction(fd);
        if (res?.error) {
          setInlineError(res.error);
          toastApi.pushToast('error', res.error);
          return;
        }
        setEditing(false);
        toastApi.pushToast('success', 'Display name updated.');
      } catch {
        const message = 'Could not update your display name. Please try again.';
        setInlineError(message);
        toastApi.pushToast('error', message);
      }
    });
  };

  return (
    <Section
      title="Profile"
      description="Public identity and basic account details."
    >
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-base font-medium text-foreground">
          {user.image ? (
            <img
              src={user.image}
              alt={user.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <span>
              {(user.name || user.email).charAt(0).toUpperCase() || '?'}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-foreground">
            {user.name}
          </p>
          <span
            className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${getRoleBadgeStyle(user.role)}`}
          >
            {user.role}
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-1">
        <FieldRow
          label="Display Name"
          value={
            editing ? (
              <input
                ref={nameRef}
                defaultValue={user.name}
                maxLength={80}
                className="w-full rounded-xl border border-border/60 bg-background px-4 py-2.5 text-[14px] outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
              />
            ) : (
              user.name
            )
          }
          action={
            canManageProfile ? (
              editing ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isPending}
                    className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
                  >
                    {isPending ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setInlineError('');
                    }}
                    className="rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-lg border border-border/60 bg-background px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Edit
                </button>
              )
            ) : (
              <span className="text-xs text-muted-foreground">View only</span>
            )
          }
        />
        <FieldRow label="Email" value={user.email} />
      </div>

      {inlineError ? (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {inlineError}
        </p>
      ) : null}
    </Section>
  );
}

function DangerSection({
  requiresDeletePassword,
  toastApi,
}: {
  requiresDeletePassword: boolean;
  toastApi: ToastApi;
}) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [inlineError, setInlineError] = useState('');
  const [isPending, start] = useTransition();

  const submitDelete = () => {
    if (requiresDeletePassword) {
      const trimmed = password.trim();
      if (!trimmed) {
        setInlineError('Password is required.');
        return;
      }
    }

    start(async () => {
      const fd = new FormData();
      if (requiresDeletePassword) {
        fd.append('password', password.trim());
      }
      try {
        const res = await deleteAccountAction(fd);
        if (res?.error) {
          setInlineError(res.error);
          toastApi.pushToast('error', res.error);
          return;
        }
        // Success: action no longer redirects server-side (which previously
        // got swallowed by this try/catch and surfaced a misleading error).
        // Drive navigation from the client instead.
        toastApi.pushToast('success', 'Account deleted.');
        setDeleteOpen(false);
        router.replace('/');
      } catch {
        const message = 'Could not delete your account. Please try again.';
        setInlineError(message);
        toastApi.pushToast('error', message);
      }
    });
  };

  return (
    <Section
      title="Danger Zone"
      description="High-impact actions. Use with care."
    >
      <FieldRow
        label="Delete Account"
        value="Permanently remove your account and its data."
        action={
          <button
            type="button"
            onClick={() => {
              setInlineError('');
              setDeleteOpen(true);
            }}
            className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2 text-[13px] font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
          >
            Delete
          </button>
        }
      />

      <ActionDialog
        open={deleteOpen}
        title="Delete account"
        description={
          requiresDeletePassword
            ? 'This action cannot be undone. Enter your password to confirm permanently deleting your account.'
            : 'This action cannot be undone. Your account will be permanently deleted.'
        }
        confirmLabel="Delete account"
        destructive
        pending={isPending}
        onClose={() => {
          if (isPending) return;
          setDeleteOpen(false);
          setPassword('');
          setInlineError('');
        }}
        onConfirm={submitDelete}
      >
        {requiresDeletePassword ? (
          <>
            <PasswordInput
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setInlineError('');
              }}
              placeholder="Confirm password"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
            />
            {inlineError ? (
              <p className="mt-2 text-xs text-red-300">{inlineError}</p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            You signed in via OAuth. Click delete to permanently remove your
            account.
          </p>
        )}
      </ActionDialog>
    </Section>
  );
}

function ThemeSection({
  canManageTheme,
  toastApi,
}: {
  canManageTheme: boolean;
  toastApi: ToastApi;
}) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isPending, start] = useTransition();

  useEffect(() => {
    const resolved = resolveThemeFromBrowser();
    setTheme(resolved);
    applyTheme(resolved);
  }, []);

  const handleToggleTheme = () => {
    start(async () => {
      try {
        const res = await toggleThemePreferenceAction();
        if (res?.error) {
          toastApi.pushToast('error', res.error);
          return;
        }
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        applyTheme(next);
        toastApi.pushToast('success', `Theme switched to ${next}.`);
      } catch {
        toastApi.pushToast('error', 'Could not update theme right now.');
      }
    });
  };

  return (
    <Section
      title="Appearance"
      description="Theme controls for your workspace."
    >
      <FieldRow
        label="Theme"
        value={
          canManageTheme
            ? `Current theme: ${theme}`
            : 'Theme control is restricted for your account.'
        }
        action={
          <button
            type="button"
            onClick={handleToggleTheme}
            disabled={isPending || !canManageTheme}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            {isPending
              ? 'Updating...'
              : theme === 'dark'
                ? 'Use light'
                : 'Use dark'}
          </button>
        }
      />
    </Section>
  );
}

function LabsSection({
  canManageLabs,
  toastApi,
}: {
  canManageLabs: boolean;
  toastApi: ToastApi;
}) {
  const [isPending, start] = useTransition();

  const handleLabsAction = () => {
    start(async () => {
      try {
        const res = await runLabsSettingAction();
        if (res?.error) {
          toastApi.pushToast('error', res.error);
          return;
        }
        toastApi.pushToast('success', res?.message ?? 'Labs action executed.');
      } catch {
        toastApi.pushToast(
          'error',
          'Could not run labs action. Please try again.',
        );
      }
    });
  };

  return (
    <Section
      title="Labs"
      description="Advanced workspace controls for privileged users."
    >
      <FieldRow
        label="Run Labs Action"
        value={
          canManageLabs
            ? 'Labs features are available for your account.'
            : 'Labs features are restricted for your account.'
        }
        action={
          <button
            type="button"
            onClick={handleLabsAction}
            disabled={isPending || !canManageLabs}
            className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
          >
            {isPending ? 'Running...' : 'Run'}
          </button>
        }
      />
    </Section>
  );
}

export function SettingsClient({
  user,
  perms,
  requiresDeletePassword,
}: {
  user: UserProps;
  perms: SettingsPerms;
  requiresDeletePassword: boolean;
}) {
  const { pushToast } = useToast();

  return (
    <div className="space-y-5">
      <ProfileSection
        user={user}
        canManageProfile={perms.canManageProfile}
        toastApi={{ pushToast }}
      />
      <ThemeSection
        canManageTheme={perms.canManageTheme}
        toastApi={{ pushToast }}
      />
      <LabsSection
        canManageLabs={perms.canManageLabs}
        toastApi={{ pushToast }}
      />
      <DangerSection
        requiresDeletePassword={requiresDeletePassword}
        toastApi={{ pushToast }}
      />
    </div>
  );
}
