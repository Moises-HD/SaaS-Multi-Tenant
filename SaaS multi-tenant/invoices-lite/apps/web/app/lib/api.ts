const API_BASE =
  typeof window !== 'undefined'
    ? window.location.origin.replace(':3000', ':3001')
    : process.env.NEXT_PUBLIC_API_BASE ?? 'http://acme2.127.0.0.1.nip.io:3001';

export async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); msg = j.message || JSON.stringify(j); } catch {}
    throw new Error(msg);
  }
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
