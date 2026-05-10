'use client';

import { useRef, useState, useTransition } from 'react';
import {
  updateDisplayNameAction,
  runLabsSettingAction,
  toggleThemePreferenceAction,
  deleteAccountAction,
} from '../actions';

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

const ROLE_COLOR: Record<string, string> = {
  superAdmin: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  admin: 'bg-blue-500/10   text-blue-400   border-blue-500/20',
  operator: 'bg-amber-500/10  text-amber-400  border-amber-500/20',
  user: 'bg-muted text-muted-foreground   border-border/50',
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
    <div className="bg-card border border-border/50 rounded-xl p-5 space-y-4">
      <div className="border-b border-border/30 pb-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {description && (
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
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
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        <div className="text-[13px] text-muted-foreground truncate">
          {value}
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function ProfileSection({
  user,
  canManageProfile,
}: {
  user: UserProps;
  canManageProfile: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState('');
  const [isPending, start] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (!canManageProfile) return;
    setMsg('');
    const fd = new FormData();
    fd.append('name', nameRef.current?.value ?? user.name);
    start(async () => {
      const res = await updateDisplayNameAction(fd);
      if (res?.error) {
        setMsg(res.error);
        return;
      }
      setEditing(false);
      setMsg('Name updated!');
      setTimeout(() => setMsg(''), 3000);
    });
  };

  return (
    <Section title="Profile" description="Your public profile information.">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full overflow-hidden border border-border/40 bg-secondary flex items-center justify-center text-xl font-bold text-foreground/50 shrink-0">
          {user.image ? (
            <img
              src={user.image}
              alt={user.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <span>
              {(user.name || user.email).charAt(0).toUpperCase() || '?'}
            </span>
          )}
        </div>
        <div>
          <p className="font-medium">{user.name}</p>
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wide ${ROLE_COLOR[user.role as keyof typeof ROLE_COLOR] ?? ROLE_COLOR.user}`}
          >
            {user.role}
          </span>
        </div>
      </div>
      <div className="space-y-4 mt-4">
        <FieldRow
          label="Display Name"
          value={
            editing ? (
              <input
                ref={nameRef}
                defaultValue={user.name}
                className="mt-1 px-3 py-1.5 bg-background border border-border/60 rounded-lg text-sm outline-none focus:border-primary/50 w-full"
              />
            ) : (
              user.name
            )
          }
          action={
            canManageProfile && editing ? (
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={isPending}
                  className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="text-xs px-3 py-1.5 bg-secondary rounded-lg"
                >
                  Cancel
                </button>
              </div>
            ) : canManageProfile ? (
              <button
                onClick={() => setEditing(true)}
                className="text-xs px-3 py-1.5 bg-muted border border-border/50 rounded-lg"
              >
                Edit
              </button>
            ) : (
              <span className="text-xs text-muted-foreground/70">
                View only
              </span>
            )
          }
        />
        <FieldRow label="Email" value={user.email} />
      </div>
    </Section>
  );
}

function DangerSection({ canManageDanger }: { canManageDanger: boolean }) {
  const [msg, setMsg] = useState('');
  const [isPending, start] = useTransition();

  const handleDelete = () => {
    if (!canManageDanger) return;
    const password = prompt(
      'Confirm with your password to delete this account:',
    )?.trim();
    if (!password) return;
    start(async () => {
      const fd = new FormData();
      fd.append('password', password);
      const res = await deleteAccountAction(fd);
      if (res?.error) setMsg(res.error);
    });
  };

  return (
    <Section title="Danger Zone" description="Irreversible actions.">
      <FieldRow
        label="Delete Account"
        value="Permanently remove your account and all data."
        action={
          <button
            onClick={handleDelete}
            disabled={isPending || !canManageDanger}
            className="text-xs px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg disabled:opacity-50"
          >
            Delete
          </button>
        }
      />
      {!canManageDanger && (
        <p className="text-xs text-muted-foreground/80">
          Only admin roles can perform dangerous account actions.
        </p>
      )}
      {msg && <p className="text-xs text-red-400">{msg}</p>}
    </Section>
  );
}

function ThemeSection({ canManageTheme }: { canManageTheme: boolean }) {
  const [msg, setMsg] = useState('');
  const [isPending, start] = useTransition();

  const handleToggleTheme = () => {
    start(async () => {
      setMsg('');
      const res = await toggleThemePreferenceAction();
      setMsg(res?.error ?? res?.message ?? 'Done.');
    });
  };

  return (
    <Section
      title="Appearance"
      description="Theme controls are permission-gated for demo access control."
    >
      <FieldRow
        label="Dark / Light Theme"
        value={
          canManageTheme
            ? 'Allowed for your account'
            : 'Restricted for your account'
        }
        action={
          <button
            onClick={handleToggleTheme}
            disabled={isPending}
            className="text-xs px-3 py-1.5 bg-muted border border-border/50 rounded-lg disabled:opacity-50"
          >
            Toggle Theme
          </button>
        }
      />
      {msg && (
        <p
          className={`text-xs ${msg.toLowerCase().includes('permission') ? 'text-red-400' : 'text-green-400'}`}
        >
          {msg}
        </p>
      )}
    </Section>
  );
}

function LabsSection({ canManageLabs }: { canManageLabs: boolean }) {
  const [msg, setMsg] = useState('');
  const [isPending, start] = useTransition();

  const handleLabsAction = () => {
    start(async () => {
      setMsg('');
      const res = await runLabsSettingAction();
      setMsg(res?.error ?? res?.message ?? 'Done.');
    });
  };

  return (
    <Section
      title="Labs"
      description="Advanced setting gate to demonstrate operator/admin differences."
    >
      <FieldRow
        label="Run Labs Toggle"
        value={
          canManageLabs
            ? 'Allowed for your account'
            : 'Restricted for your account'
        }
        action={
          <button
            onClick={handleLabsAction}
            disabled={isPending}
            className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
          >
            Run Labs Action
          </button>
        }
      />
      {msg && (
        <p
          className={`text-xs ${msg.toLowerCase().includes('permission') ? 'text-red-400' : 'text-green-400'}`}
        >
          {msg}
        </p>
      )}
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
  return (
    <div className="space-y-6">
      <ProfileSection user={user} canManageProfile={perms.canManageProfile} />
      <ThemeSection canManageTheme={perms.canManageTheme} />
      <LabsSection canManageLabs={perms.canManageLabs} />
      <DangerSection canManageDanger={perms.canManageDanger} />
    </div>
  );
}
