/**
 * @jest-environment jsdom
 */
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
});

import {
  resolveThemeFromBrowser,
  applyTheme,
  THEME_STORAGE_KEY,
  THEME_INIT_SCRIPT,
  type ThemeMode,
} from './theme';

describe('THEME_STORAGE_KEY', () => {
  it('is "theme"', () => {
    expect(THEME_STORAGE_KEY).toBe('theme');
  });
});

describe('THEME_INIT_SCRIPT', () => {
  it('is a non-empty string', () => {
    expect(typeof THEME_INIT_SCRIPT).toBe('string');
    expect(THEME_INIT_SCRIPT.length).toBeGreaterThan(0);
  });

  it('references localStorage', () => {
    expect(THEME_INIT_SCRIPT).toContain('localStorage');
  });

  it('references prefers-color-scheme', () => {
    expect(THEME_INIT_SCRIPT).toContain('prefers-color-scheme');
  });
});

describe('resolveThemeFromBrowser', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns stored theme when valid', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(resolveThemeFromBrowser()).toBe('dark');
  });

  it('returns "light" when stored as "light"', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(resolveThemeFromBrowser()).toBe('light');
  });

  it('returns system preference when no stored value', () => {
    // jsdom doesn't matchMedia by default, so it falls back to 'light'
    expect(resolveThemeFromBrowser()).toBe('light');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'invalid');
    expect(resolveThemeFromBrowser()).toMatch(/^(light|dark)$/);
  });
});

describe('applyTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('stores theme in localStorage', () => {
    applyTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('toggles dark class on documentElement', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes dark class when light', () => {
    document.documentElement.classList.add('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('sets a cookie', () => {
    applyTheme('dark');
    expect(document.cookie).toContain('theme=dark');
  });
});
