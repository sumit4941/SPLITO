import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import '@splito/ui/styles.css';
import './styles.css';
import './i18n';
import { App } from './App';
import { SafeErrorBoundary } from './components/SafeErrorBoundary';
import { ThemeProvider } from './providers/ThemeProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry(failureCount, error) {
        const status =
          typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
        if ([401, 403, 404].includes(status)) return false;
        return failureCount < 2;
      },
      staleTime: 20_000,
    },
    mutations: { retry: false },
  },
});

registerSW({
  immediate: false,
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent('splito:update-available'));
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SafeErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeErrorBoundary>
  </StrictMode>,
);
