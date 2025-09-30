'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

/* ───────── tipos ───────── */
type Customer = { id: string; name: string; email: string };
type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
type MeResponse = any;

/* ───────── helpers dominio/tenant ───────── */
function currentHost() {
  if (typeof window === 'undefined') return 'acme2.127.0.0.1.nip.io';
  return window.location.hostname;
}
function getTenantSlugFromHost(host = currentHost()) {
  // acme2.127.0.0.1.nip.io  -> "acme2"
  const m = host.toLowerCase().match(/^([a-z0-9-]+)\./);
  return m?.[1] ?? 'acme2';
}

/* ───────── helpers API (mismo dominio del tenant) ───────── */
function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  const host = currentHost();
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
  return `${protocol}//${host}:3001`;
}
const API_BASE = resolveApiBase();

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include', ...init });
  } catch {
    throw new Error(
      `No puedo conectar con la API en ${url}. Abre el front en http://acme2.127.0.0.1.nip.io:3000 (no localhost).`
    );
  }
  if (res.status !== 401) return res;

  const rf = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!rf.ok) return res;
  return fetch(url, { credentials: 'include', ...init });
}

async function parseList(res: Response) {
  const t = await res.text();
  if (!t) return [];
  const j = JSON.parse(t);
  if (Array.isArray(j)) return j;
  if (Array.isArray(j?.items)) return j.items;
  if (Array.isArray(j?.data)) return j.data;
  return [];
}
async function parseItem(res: Response) {
  const t = await res.text();
  const j = t ? JSON.parse(t) : {};
  return j?.item ?? j?.data ?? j;
}

/* ───────── resolver rol desde /auth/me ───────── */
function resolveRoleFromMe(me: any, tenantSlug: string): Role | undefined {

  if (me?.user?.role) return me.user.role as Role;

  if (me?.role) return me.role as Role;
  if (me?.membership?.role) return me.membership.role as Role;

  const memberships: any[] = me?.memberships ?? me?.user?.memberships ?? [];

  const match =
    memberships.find(m => m?.tenant?.slug?.toLowerCase?.() === tenantSlug) ||
    memberships.find(m => m?.tenantSlug?.toLowerCase?.() === tenantSlug) ||
    memberships.find(m => m?.tenantId && m.tenantId === me?.user?.tenantId); // por tenantId si coincide

  if (match?.role) return match.role as Role;

  const prefer = (r: Role) => memberships.find(m => m?.role === r);
  return (prefer('OWNER')?.role || prefer('ADMIN')?.role || memberships[0]?.role) as Role | undefined;
}


/* ───────── modal crear/editar ───────── */
function CustomerModal({
  open, onOpenChange, initial, onSaved, canWrite,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Partial<Customer>;
  onSaved: () => void;
  canWrite: boolean;
}) {
  const isEdit = Boolean(initial?.id);
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setName(initial?.name ?? '');
    setEmail(initial?.email ?? '');
  }, [initial, open]);

  async function submit() {
    if (!canWrite) {
      toast.error('No tienes permisos para esta acción. Inicia sesión como OWNER/ADMIN.');
      return;
    }
    if (!name.trim() || !email.trim()) {
      toast.error('Nombre y email son obligatorios');
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(
        isEdit ? `/customers/${initial!.id}` : `/customers`,
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), email: email.trim() }),
        },
      );

      if (res.status === 403) throw new Error('No tienes permisos para esta acción (403). Inicia sesión como OWNER/ADMIN.');
      if (!res.ok) throw new Error(await res.text().catch(() => 'Error guardando'));

      await parseItem(res);
      toast.success(isEdit ? 'Cliente actualizado' : 'Cliente creado');
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar cliente' : 'Nuevo cliente'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Actualiza los datos del cliente.' : 'Introduce los datos del nuevo cliente.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" disabled={!canWrite} />
          </div>
          <div className="grid gap-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="facturacion@acme.com" disabled={!canWrite} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button onClick={submit} disabled={loading || !canWrite}>
            {loading ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────── página ───────── */
export default function CustomersPage() {
  const [raw, setRaw] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | undefined>(undefined);

  // sesión/rol
  const [me, setMe] = useState<{ email?: string; role?: Role } | null>(null);
  const canWrite = me?.role === 'OWNER' || me?.role === 'ADMIN';

  const [confirming, setConfirming] = useState<Customer | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);

  // DEBUG STATE
  const [showDbg, setShowDbg] = useState(false);
  const [dbg, setDbg] = useState<{ apiBase: string; tenant: string; rawMe?: any; role?: Role } | null>(null);

  async function fetchMe() {
    try {
      const res = await apiFetch('/auth/me');
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();
      const tenantSlug = getTenantSlugFromHost();
      const role = resolveRoleFromMe(j, tenantSlug);
      const email = j?.email ?? j?.user?.email;   
      setMe({ email, role });


      // ---- DEBUG: consola y estado visible ----
      //console.groupCollapsed('[Customers] /auth/me debug');
      //console.log('API_BASE:', API_BASE);
      //console.log('tenantSlug:', tenantSlug);
      //console.log('raw /auth/me:', j);
      //console.log('resolved role:', role);
      //console.groupEnd();
      setDbg({ apiBase: API_BASE, tenant: tenantSlug, rawMe: j, role });

      setMe({ email, role });
    } catch (e) {
      //console.error('[Customers] error en fetchMe', e);
      toast.error('No se pudo obtener la sesión');
    }
  }

  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  async function fetchList() {
    setLoading(true);
    try {
      const res = await apiFetch(`/customers?limit=500`);
      if (res.status === 403) throw new Error('No tienes permisos para ver clientes (403).');
      if (!res.ok) throw new Error(await res.text().catch(() => 'Error listando'));
      const list = await parseList(res);
      setRaw(list);
    } catch (e: any) {
      toast.error(e?.message || 'Error cargando clientes');
      setRaw([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMe().then(fetchList);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return raw;
    return raw.filter(c => c.name?.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s));
  }, [raw, q]);

  async function doDelete() {
    if (!confirming) return;
    if (!canWrite) {
      toast.error('No tienes permisos para eliminar. Inicia sesión como OWNER/ADMIN.');
      return;
    }
    setDeleting(true);
    try {
      const res = await apiFetch(`/customers/${confirming.id}`, { method: 'DELETE' });
      if (res.status === 403) throw new Error('No tienes permisos para eliminar (403).');
      if (!res.ok) throw new Error(await res.text().catch(() => 'Error eliminando'));
      toast.success('Cliente eliminado');
      setConfirming(undefined);
      fetchList();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo eliminar');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Email cliente:
            {me?.email && (
              <span className="ml-2 text-xs">
                <b>{me.email}</b>
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
            <Input className="pl-9 sm:w-[280px]" placeholder="Buscar por nombre o email…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button
              className="gap-2"
              onClick={() => {
                if (!canWrite) {
                  toast.error('Tu cuenta es de solo lectura. Inicia sesión como OWNER/ADMIN para crear.');
                  return;
                }
                setEditing(undefined);
                setModalOpen(true);
              }}
              variant={canWrite ? 'default' : 'outline'}
            >
              <Plus className="h-4 w-4" /> Nuevo cliente
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-background">
        <div className="grid grid-cols-12 gap-4 bg-muted/50 px-4 py-3 text-xs font-medium text-muted-foreground">
          <div className="col-span-5 sm:col-span-4">Nombre</div>
          <div className="col-span-5 sm:col-span-6">Email</div>
          <div className="col-span-2 text-right">Acciones</div>
        </div>

        <div className="divide-y">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-4 px-4 py-3">
                <div className="col-span-5 sm:col-span-4 h-4 animate-pulse rounded bg-muted" />
                <div className="col-span-5 sm:col-span-6 h-4 animate-pulse rounded bg-muted" />
                <div className="col-span-2 h-8 w-28 animate-pulse rounded bg-muted justify-self-end" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">No hay clientes.</div>
          ) : (
            filtered.map((c) => (
              <div key={c.id} className="group grid grid-cols-12 items-center gap-4 px-4 py-3 transition hover:bg-muted/30">
                <div className="col-span-5 sm:col-span-4 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-sm font-medium">
                    {c.name?.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.name || <span className="opacity-60">Sin nombre</span>}</div>
                  </div>
                </div>
                <div className="col-span-5 sm:col-span-6 min-w-0">
                  <div className="truncate">{c.email}</div>
                </div>
                <div className="col-span-2 flex items-center justify-end gap-1">
                  <Button
                    variant={canWrite ? 'outline' : 'ghost'}
                    size="sm"
                    className="gap-1"
                    disabled={!canWrite}
                    onClick={() => {
                      if (!canWrite) {
                        toast.error('Tu cuenta es de solo lectura. Inicia sesión como OWNER/ADMIN para editar.');
                        return;
                      }
                      setEditing(c);
                      setModalOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" /> <span className="hidden sm:inline">Editar</span>
                  </Button>
                  <Button
                    variant={canWrite ? 'destructive' : 'ghost'}
                    size="sm"
                    className="gap-1"
                    disabled={!canWrite}
                    onClick={() => {
                      if (!canWrite) {
                        toast.error('Tu cuenta es de solo lectura. Inicia sesión como OWNER/ADMIN para eliminar.');
                        return;
                      }
                      setConfirming(c);
                    }}
                  >
                    <Trash2 className="h-4 w-4" /> <span className="hidden sm:inline">Eliminar</span>
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modal crear/editar */}
      <CustomerModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        initial={editing}
        onSaved={fetchList}
        canWrite={canWrite}
      />

      {/* Confirmación de borrado */}
      <Dialog open={Boolean(confirming)} onOpenChange={(v) => !deleting && !v && setConfirming(undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar cliente</DialogTitle>
            <DialogDescription>¿Seguro que quieres eliminar <b>{confirming?.name}</b>? Esta acción no se puede deshacer.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirming(undefined)} disabled={deleting}>Cancelar</Button>
            <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={doDelete} disabled={deleting}>
              {deleting ? 'Eliminando…' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
