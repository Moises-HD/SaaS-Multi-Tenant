import { NextRequest } from 'next/server';
const API_URL = process.env.API_URL || 'http://127.0.0.1:3001';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handler(req: NextRequest, { params }: { params: { path: string[] } }) {
  const target = `${API_URL}/${(params.path || []).join('/')}`;
  const fwd = new Headers(req.headers);
  fwd.delete('host'); fwd.delete('connection'); fwd.delete('content-length'); fwd.delete('content-encoding');
  const needsBody = !['GET','HEAD'].includes(req.method);
  const body = needsBody ? Buffer.from(await req.arrayBuffer()) : undefined;

  try {
    const r = await fetch(target, { method: req.method, headers: fwd, body, redirect: 'manual', cache: 'no-store' });
    const h = new Headers(r.headers); h.delete('content-encoding'); h.delete('content-length'); h.delete('connection');
    return new Response(await r.text(), { status: r.status, headers: h });
  } catch (e: any) {
    console.error('Proxy error →', { target, err: e?.message || String(e) });
    return Response.json({ error: 'Bad gateway', target, message: e?.message || String(e) }, { status: 502 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as OPTIONS };
