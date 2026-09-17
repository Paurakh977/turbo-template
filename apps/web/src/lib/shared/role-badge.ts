const DEFAULT_ROLE_BADGE_STYLE =
  'bg-muted text-muted-foreground border border-border/50';

export const ROLE_BADGE_STYLE: Record<string, string> = {
  superAdmin: 'bg-primary text-primary-foreground',
  admin: 'bg-primary text-primary-foreground',
  operator:
    'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20',
  user: DEFAULT_ROLE_BADGE_STYLE,
};

export function getRoleBadgeStyle(role: string): string {
  return ROLE_BADGE_STYLE[role] ?? DEFAULT_ROLE_BADGE_STYLE;
}
