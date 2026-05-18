export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme';
export const THEME_QUERY = '(prefers-color-scheme: dark)';

export const THEME_INIT_SCRIPT = `
(function() {
  try {
    var t = localStorage.getItem('${THEME_STORAGE_KEY}');
    var d = window.matchMedia('${THEME_QUERY}').matches;
    var r = t === 'dark' || t === 'light' ? t : (d ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', r === 'dark');
    document.cookie = '${THEME_STORAGE_KEY}=' + r + '; path=/; max-age=31536000; SameSite=Lax';
  } catch (_) {}
})();
`;


export function resolveThemeFromBrowser(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;

  return window.matchMedia(THEME_QUERY).matches ? 'dark' : 'light';
}

export function applyTheme(theme: ThemeMode): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  document.cookie = `${THEME_STORAGE_KEY}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}
