'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  updateDisplayNameAction,
  runLabsSettingAction,
  toggleThemePreferenceAction,
  deleteAccountAction,
} from '../actions';
import { ActionDialog } from '../../../_components/ActionDialog';
import {
  ToastRegion,
  type ToastItem,
  type ToastKind,
} from '../../../_components/ToastRegion';

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
  canManageDanger: boolean;
};

type ToastApi = {
  pushToast: (kind: ToastKind, message: string) => void;
};

const ROLE_COLOR: Record<string, string> = {
  superAdmin: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  admin: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  operator: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  user: 'bg-muted/60 text-muted-foreground border-border/70',
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
    <section className="rounded-2xl border border-border/70 bg-card/80 p-5 shadow-sm sm:p-6">
      <div className="mb-4 border-b border-border/40 pb-3">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
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
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <div className="mt-1 text-sm text-foreground/90">{value}</div>
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
      const res = await updateDisplayNameAction(fd);
      if (res?.error) {
        setInlineError(res.error);
        toastApi.pushToast('error', res.error);
        return;
      }
      setEditing(false);
      toastApi.pushToast('success', 'Display name updated.');
    });
  };

  return (
    <Section
      title="Profile"
      description="Public identity and basic account details."
    >
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-secondary text-base font-semibold text-foreground/70">
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
          <p className="truncate text-sm font-semibold text-foreground">
            {user.name}
          </p>
          <span
            className={`mt-1 inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ROLE_COLOR[user.role] ?? ROLE_COLOR.user}`}
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
                className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
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
                  className="rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/40"
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
  canManageDanger,
  toastApi,
}: {
  canManageDanger: boolean;
  toastApi: ToastApi;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [inlineError, setInlineError] = useState('');
  const [isPending, start] = useTransition();

  const submitDelete = () => {
    if (!canManageDanger) return;
    const trimmed = password.trim();
    if (!trimmed) {
      setInlineError('Password is required.');
      return;
    }

    start(async () => {
      const fd = new FormData();
      fd.append('password', trimmed);
      const res = await deleteAccountAction(fd);
      if (res?.error) {
        setInlineError(res.error);
        toastApi.pushToast('error', res.error);
        return;
      }
      toastApi.pushToast('success', 'Account deletion requested.');
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
            disabled={!canManageDanger}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
          >
            Delete
          </button>
        }
      />

      {!canManageDanger ? (
        <p className="text-xs text-muted-foreground">
          Only admin roles can perform dangerous account actions.
        </p>
      ) : null}

      <ActionDialog
        open={deleteOpen}
        title="Delete account"
        description="This action cannot be undone. Enter your password to confirm permanently deleting this account."
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
        <input
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setInlineError('');
          }}
          placeholder="Confirm password"
          className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
        />
        {inlineError ? (
          <p className="mt-2 text-xs text-red-300">{inlineError}</p>
        ) : null}
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
  const [isPending, start] = useTransition();

  const handleToggleTheme = () => {
    start(async () => {
      const res = await toggleThemePreferenceAction();
      if (res?.error) {
        toastApi.pushToast('error', res.error);
        return;
      }
      toastApi.pushToast(
        'success',
        res?.message ?? 'Theme preference updated.',
      );
    });
  };

  return (
    <Section
      title="Appearance"
      description="Theme controls for your workspace."
    >
      <FieldRow
        label="Dark or Light Theme"
        value={
          canManageTheme
            ? 'Theme preferences are available for your account.'
            : 'Theme control is restricted for your account.'
        }
        action={
          <button
            type="button"
            onClick={handleToggleTheme}
            disabled={isPending || !canManageTheme}
            className="rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
          >
            {isPending ? 'Updating...' : 'Toggle Theme'}
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
      const res = await runLabsSettingAction();
      if (res?.error) {
        toastApi.pushToast('error', res.error);
        return;
      }
      toastApi.pushToast('success', res?.message ?? 'Labs action executed.');
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
            className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
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
}: {
  user: UserProps;
  perms: SettingsPerms;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = (kind: ToastKind, message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, kind, message }]);
  };

  const dismissToast = (id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => dismissToast(toast.id), 3500),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [toasts]);

  return (
    <>
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
          canManageDanger={perms.canManageDanger}
          toastApi={{ pushToast }}
        />
      </div>
      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
