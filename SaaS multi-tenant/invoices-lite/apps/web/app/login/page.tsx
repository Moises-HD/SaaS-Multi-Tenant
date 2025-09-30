'use client';
import React, { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:3001`;
  }
  return 'http://acme2.127.0.0.1.nip.io:3001';
}
const API_BASE = resolveApiBase();

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('owner@acme2.com');
  const [password, setPassword] = useState('Password123');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000); 

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        setError(msg || `Login failed (${res.status})`);
        return;
      }

      router.replace('/customers'); 
    } catch (e: any) {
      setError(e?.name === 'AbortError' ? 'Timeout de la API' : 'fetch failed');
    } finally {
      clearTimeout(t);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-md mx-auto mt-16 p-6 bg-white/70 rounded-xl">
      <h1 className="text-2xl font-bold mb-4">Login</h1>

      <label className="block">
        <div className="text-sm mb-1">Email</div>
        <input
          className="w-full rounded-md border px-3 py-2"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
        />
      </label>

      <label className="block">
        <div className="text-sm mb-1">Password</div>
        <input
          className="w-full rounded-md border px-3 py-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
        />
      </label>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <button
        className="w-full rounded-md bg-blue-600 text-white py-2 disabled:opacity-60"
        type="submit"
        disabled={pending}
      >
        {pending ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
