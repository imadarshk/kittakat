export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_KEY = 'kittakat-theme';

export function readTheme():ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; }
}

/** `system` removes the attribute so the stylesheet follows prefers-color-scheme. */
export function applyTheme(theme:ThemePreference):void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch { /* Private browsing: the choice still applies to this visit. */ }
}

/** Runs before paint so a saved dark preference never flashes light. */
export const themeBootScript = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;
