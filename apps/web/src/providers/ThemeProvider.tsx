import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  preference: ThemePreference;
  reducedMotion: boolean;
  resolvedTheme: 'light' | 'dark';
  setPreference: (preference: ThemePreference) => void;
  setReducedMotion: (value: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function validPreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    const stored = localStorage.getItem('splito.theme');
    return validPreference(stored) ? stored : 'system';
  });
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [reducedMotion, setReducedMotionState] = useState(
    () => localStorage.getItem('splito.reducedMotion') === 'true',
  );
  const resolvedTheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = resolvedTheme;
    localStorage.setItem('splito.theme', preference);
  }, [preference, resolvedTheme]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
    localStorage.setItem('splito.reducedMotion', String(reducedMotion));
  }, [reducedMotion]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      reducedMotion,
      resolvedTheme,
      setPreference: setPreferenceState,
      setReducedMotion: setReducedMotionState,
    }),
    [preference, reducedMotion, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
