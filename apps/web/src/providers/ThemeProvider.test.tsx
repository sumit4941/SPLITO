import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeProvider';

function Harness() {
  const { preference, reducedMotion, setPreference, setReducedMotion } = useTheme();
  return (
    <>
      <output>
        {preference}:{String(reducedMotion)}
      </output>
      <button onClick={() => setPreference('dark')}>Dark</button>
      <button onClick={() => setReducedMotion(true)}>Reduce</button>
    </>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => localStorage.clear());

  it('persists a theme and reduced-animation preference without auth storage', () => {
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reduce' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement).toHaveAttribute('data-reduced-motion', 'true');
    expect(localStorage.getItem('splito.theme')).toBe('dark');
    expect(localStorage.getItem('splito.reducedMotion')).toBe('true');
    const keys = Array.from(
      { length: localStorage.length },
      (_, index) => localStorage.key(index) ?? '',
    );
    expect(keys).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/token|session|auth/i)]),
    );
  });
});
