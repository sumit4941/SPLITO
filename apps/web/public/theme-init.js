(() => {
  try {
    const preference = globalThis.localStorage.getItem('splito.theme') || 'system';
    const resolved =
      preference === 'system'
        ? globalThis.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : preference;
    globalThis.document.documentElement.dataset.theme = resolved;
    globalThis.document.documentElement.dataset.themePreference = preference;
    globalThis.document.documentElement.style.colorScheme = resolved;
    const reduced = globalThis.localStorage.getItem('splito.reducedMotion') === 'true';
    globalThis.document.documentElement.dataset.reducedMotion = String(reduced);
  } catch {
    globalThis.document.documentElement.dataset.theme = 'light';
  }
})();
