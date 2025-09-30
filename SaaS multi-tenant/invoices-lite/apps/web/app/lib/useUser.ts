'use client';
import { useEffect, useState } from 'react';

type UserMe =
  | { user: { sub: string; email: string; tenantId: string; role: string } }
  | { message?: string; statusCode?: number };

export function useUser() {
  const [data, setData] = useState<UserMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        const j = (await r.json()) as UserMe;
        if (!cancelled) setData(j);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const user =
    data && 'user' in data ? data.user : null;

  return { user, loading };
}
