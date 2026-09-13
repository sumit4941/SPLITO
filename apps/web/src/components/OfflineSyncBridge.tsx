import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { syncAccountQueue } from '../lib/offline';

export function OfflineSyncBridge({ accountId }: { accountId?: string }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    const sync = async () => {
      if (!active || !navigator.onLine) return;
      await syncAccountQueue(accountId);
      if (active) await queryClient.invalidateQueries();
    };
    const onOnline = () => void sync();
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => void sync(), 30_000);
    void sync();
    return () => {
      active = false;
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [accountId, queryClient]);

  return null;
}
