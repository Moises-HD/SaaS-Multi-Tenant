'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Customer = { id?: string; name: string; email: string };

export default function CustomerForm({
  initial,
  mode, // 'create' | 'edit'
}: {
  initial?: Customer;
  mode: 'create' | 'edit';
}) {
  const router = useRouter();
  const [name, setName]   = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);

    try {
      const url = mode === 'create'
        ? '/api/customers'
        : `/api/customers/${initial!.id}`;

      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || `HTTP ${res.status}`);
      }

      router.push('/customers');
      router.refresh();
    } catch (e: any) {
      setErr(e.message || 'Error desconocido');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-lg">
      <div>
        <label className="block text-sm font-medium">Nombre</label>
        <input
          className="mt-1 w-full rounded-md border px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </div>
      <div>
        <label className="block text-sm font-medium">Email</label>
        <input
          className="mt-1 w-full rounded-md border px-3 py-2"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      {err && <p className="text-red-600 text-sm">{err}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-blue-600 text-white px-4 py-2 disabled:opacity-60"
        >
          {busy ? 'Guardando…' : (mode === 'create' ? 'Crear' : 'Guardar')}
        </button>
      </div>
    </form>
  );
}
