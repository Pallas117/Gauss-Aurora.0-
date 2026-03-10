/**
 * Theme Provider Component
 * Wraps next-themes ThemeProvider with custom radiation-themed configuration
 */

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { type ReactNode } from 'react';

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: 'light' | 'dark' | 'system';
  storageKey?: string;
  forceDark?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
  storageKey = 'gauss-aurora-theme',
  forceDark = true,
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={forceDark ? 'dark' : defaultTheme}
      forcedTheme={forceDark ? 'dark' : undefined}
      storageKey={storageKey}
      enableSystem={!forceDark}
      disableTransitionOnChange={false}
    >
      {children}
    </NextThemesProvider>
  );
}
