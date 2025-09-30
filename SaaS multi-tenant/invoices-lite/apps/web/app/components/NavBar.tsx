'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState } from 'react';

export default function NavBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);

  async function logout() {
    try {
      setLoading(true);
      const res = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (_) {
    } finally {
      setLoading(false);
      router.replace('/login');
    }
  }

  const linkCls = (p: string) =>
    `px-3 py-2 rounded-md ${pathname?.startsWith(p) ? 'bg-gray-200' : 'hover:bg-gray-100'}`;

  return (
    <header className="w-full border-b bg-white">
      <nav className="mx-auto max-w-5xl flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 font-semibold">
          <Link href="/" className="text-xl">Facturación</Link>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/customers" className={linkCls('/customers')}>Clientes</Link>
          <Link href="/invoices"  className={linkCls('/invoices')}>Facturas</Link>
          <button
            onClick={logout}
            disabled={loading}
            className="ml-2 rounded-md bg-gray-900 text-white px-3 py-2 disabled:opacity-60"
          >
            {loading ? 'Saliendo…' : 'Cerrar Sesión'}
          </button>
        </div>
      </nav>
    </header>
  );
}
