"use client"
import React, { useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  LayoutDashboard,
  Users,
  FileText,
  Settings as SettingsIcon,
  ChevronDown,
  Search,
  Filter,
  Plus,
  SunMedium,
  Moon,
  ArrowUpRight,
  ExternalLink,
  Trash2,
  Edit,
  CheckCircle2,
  Clock3,
  AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import Link from "next/link"

import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

/* diálogos */
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"

/* ----------------------- API helpers ----------------------- */
function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location
    return `${protocol}//${hostname}:3001`
  }
  return "http://acme2.127.0.0.1.nip.io:3001"
}
const API_BASE = resolveApiBase()

/** fetch con cookies y refresh si 401 */
async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${API_BASE}${path}`
  try {
    const first = await fetch(url, { credentials: "include", ...init })
    if (first.status !== 401) return first
    const rf = await fetch(`${API_BASE}/auth/refresh`, { method: "POST", credentials: "include" })
    if (!rf.ok) return first
    return fetch(url, { credentials: "include", ...init })
  } catch (err) {
    console.error("[authFetch] network error →", url, err)
    throw err
  }
}

/** normalizador simple para listas */
async function parseList<T = any>(res: Response): Promise<T[]> {
  const txt = await res.text()
  if (!txt) return []
  let j: any
  try { j = JSON.parse(txt) } catch { return [] }
  if (Array.isArray(j)) return j
  if (Array.isArray(j?.items)) return j.items
  if (Array.isArray(j?.data)) return j.data
  return []
}

/* error legible desde el backend */
async function parseErrorText(res: Response) {
  const raw = await res.text().catch(() => "")
  try {
    const j = JSON.parse(raw)
    return Array.isArray(j?.message) ? j.message.join(" · ") : (j?.message || j?.error || raw || res.statusText)
  } catch {
    return raw || res.statusText
  }
}

async function updateInvoice(id: string, body: any) {
  // A) PATCH
  let res = await authFetch(`/invoices/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (res.ok) return { ok: true as const }
  if (res.status !== 404 && res.status !== 405) {
    return { ok: false as const, msg: await parseErrorText(res) }
  }

  // B) PUT (fallback)
  res = await authFetch(`/invoices/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (res.ok) return { ok: true as const }
  return { ok: false as const, msg: await parseErrorText(res) }
}

/* ----------------------- Types ----------------------- */
type InvoiceStatus = "DRAFT" | "SENT" | "PAID" | "VOID"

type Customer = { id: string; name: string }

type Invoice = {
  id: string
  createdAt: string
  amountCents: number
  status: InvoiceStatus
  customer?: Customer
  customerId?: string
  customerName?: string
}

type ListResponse = {
  items: Invoice[]
  total: number
  page: number
  pageSize: number
}

/* ----------------------- Normalizadores ----------------------- */
const getAmountCents = (it: any) =>
  Number(
    it?.amountCents ??
    it?.amount_cents ??
    (typeof it?.amount === "number" ? Math.round(it.amount * 100) : 0)
  ) || 0

const getCreatedAt = (it: any) =>
  String(it?.createdAt ?? it?.issuedOn ?? it?.created_at ?? it?.created_on ?? new Date().toISOString())

const getStatus = (it: any): InvoiceStatus => {
  const s = String(it?.status ?? it?.state ?? "DRAFT").toUpperCase()
  return (["DRAFT","SENT","PAID","VOID"] as const).includes(s as any) ? (s as InvoiceStatus) : "DRAFT"
}

const getCustomerName = (it: any) =>
  it?.customer?.name ||
  it?.customerName ||
  it?.customer_name ||
  it?.customer?.fullName ||
  it?.contactName ||
  it?.customer?.email ||
  ""

const getCustomerId = (it: any) =>
  String(it?.customer?.id ?? it?.customerId ?? it?.customer_id ?? "")

function normalizeInvoicesResponse(j: any): ListResponse {
  let rawItems: any[] = []
  if (Array.isArray(j)) rawItems = j
  else if (Array.isArray(j?.items)) rawItems = j.items
  else if (Array.isArray(j?.data)) rawItems = j.data

  const items: Invoice[] = rawItems.map((it) => ({
    id: String(it?.id ?? it?._id ?? it?.uuid ?? cryptoRandom()),
    createdAt: getCreatedAt(it),
    amountCents: getAmountCents(it),
    status: getStatus(it),
    customer: {
      id: getCustomerId(it),
      name: getCustomerName(it),
    },
  }))

  const total =
    typeof j?.total === "number" && Number.isFinite(j.total) ? j.total : items.length
  const page =
    typeof j?.page === "number" && Number.isFinite(j.page) ? j.page : 0
  const pageSize =
    typeof j?.pageSize === "number" && Number.isFinite(j.pageSize)
      ? j.pageSize
      : (items.length || 25)

  return { items, total, page, pageSize }
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2, 10)
}

/* ----------------------- Helpers visuales ----------------------- */
function formatCurrencyCents(cents: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(cents / 100)
}

function statusMeta(status: InvoiceStatus) {
  switch (status) {
    case "PAID":
      return { label: "Pagada", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", icon: CheckCircle2 }
    case "SENT":
      return { label: "Enviada", className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300", icon: ArrowUpRight }
    case "VOID":
      return { label: "Anulada", className: "bg-gray-200 text-gray-700 dark:bg-gray-900 dark:text-gray-300", icon: AlertCircle }
    default:
      return { label: "Borrador", className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", icon: Clock3 }
  }
}

function initialsFromName(name?: string) {
  const s = (name || "").trim()
  if (!s) return "??"
  const parts = s.split(/\s+/)
  const letters = (parts[0]?.[0] || "") + (parts[1]?.[0] || "")
  return (letters || s.slice(0, 2)).toUpperCase()
}

/* ----------------------- Theme Toggle ----------------------- */
function ThemeToggle() {
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    const root = document.documentElement
    if (isDark) root.classList.add("dark")
    else root.classList.remove("dark")
  }, [isDark])
  return (
    <Button variant="ghost" size="icon" onClick={() => setIsDark((v) => !v)} aria-label="Cambiar tema">
      {isDark ? <SunMedium className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  )
}

/* ----------------------- Sidebar ----------------------- */
function Sidebar() {
  const pathname = usePathname()

  const NavItem = ({
    icon: Icon,
    label,
    href,
  }: {
    icon: React.ElementType
    label: string
    href: string
  }) => {
    const active =
      pathname === href || (href !== "/" && pathname?.startsWith(href))

    return (
      <Link
        href={href}
        className={cn(
          "flex items-center gap-3 rounded-xl px-3 py-2 transition hover:bg-muted",
          active && "bg-muted"
        )}
      >
        <Icon className="h-5 w-5" />
        <span className="font-medium">{label}</span>
      </Link>
    )
  }

  return (
    <aside className="hidden min-h-screen w-64 flex-col border-r bg-background p-4 md:flex">
      <div className="mb-6 flex items-center gap-3">
        <div className="h-8 w-8 rounded-xl bg-primary/10" />
        <div>
          <div className="text-sm text-muted-foreground">Tenant</div>
          <div className="text-base font-semibold">Acme Corp</div>
        </div>
      </div>

      <nav className="grid gap-1">
        <NavItem icon={LayoutDashboard} href="/panel"    label="Panel" />
        <NavItem icon={FileText}        href="/invoices" label="Facturas" />
        <NavItem icon={Users}           href="/customers" label="Clientes" />
        <NavItem icon={SettingsIcon}    href="/settings" label="Ajustes" />
      </nav>

      <div className="mt-auto" />
      <div className="mt-6 rounded-2xl border p-3">
        <div className="mb-2 text-sm font-medium">Límites del plan</div>
        <div className="text-xs text-muted-foreground">Has usado 42/100 facturas este mes.</div>
        <div className="mt-3 h-2 w-full rounded-full bg-muted">
          <div className="h-2 w-[42%] rounded-full bg-primary" />
        </div>
        <Button className="mt-3 w-full" variant="secondary" size="sm">
          Mejorar plan
        </Button>
      </div>
    </aside>
  )
}

/* ----------------------- Header ----------------------- */
function Header({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex w-full max-w-screen-2xl items-center gap-3 px-4 py-3">
        <div className="md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="gap-2"><ChevronDown className="h-4 w-4"/> Menú</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <Link href="/panel" className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-muted">Panel</Link>
              <Link href="/customers" className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-muted">Clientes</Link>
              <Link href="/settings" className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-muted">Ajustes</Link>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex-1"/>
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50"/>
          <Input
            placeholder="Buscar cliente o nº de factura…"
            className="pl-9"
            value={value}
            onChange={(e)=>onSearch(e.target.value)}
          />
        </div>
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2">
              <Avatar className="h-7 w-7"><AvatarFallback>AC</AvatarFallback></Avatar>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Mi cuenta</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Perfil</DropdownMenuItem>
            <DropdownMenuItem>Salir</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

/* ----------------------- Create Invoice Drawer ----------------------- */
function CreateInvoiceDrawer({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([])
  const [customerId, setCustomerId] = useState("")
  const [invoiceNumber, setInvoiceNumber] = useState("") // <- NUEVO
  const [issuedOn, setIssuedOn] = useState("")
  const [dueOn, setDueOn] = useState("")
  const [amount, setAmount] = useState("")
  const [sendEmail, setSendEmail] = useState(false)

  function nextInvoiceNumber() {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
    return `INV-${y}${m}${day}-${rand}`
  }

  useEffect(() => {
    if (!open) return
    setInvoiceNumber((prev) => prev || nextInvoiceNumber())

    let aborted = false
    ;(async () => {
      try {
        const res = await authFetch(`/customers?limit=200`)
        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText))
        const list = await parseList<{ id: string; name: string }>(res)
        if (!aborted) setCustomers(list)
      } catch (e) {
        console.error("[invoices] error cargando /customers →", e)
        if (!aborted) toast.error("Error cargando clientes")
      }
    })()
    return () => { aborted = true }
  }, [open])

  const reset = () => {
    setCustomerId("")
    setInvoiceNumber("")
    setIssuedOn("")
    setDueOn("")
    setAmount("")
    setSendEmail(false)
  }

  async function handleCreate() {
    if (!customerId) return toast.error("Selecciona un cliente")
    const amountNumber = Number(String(amount).replace(",", "."))
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return toast.error("Importe inválido")
    }

    const issueISO = issuedOn
      ? new Date(issuedOn).toISOString()
      : new Date().toISOString()
    const dueISO = dueOn ? new Date(dueOn).toISOString() : undefined

    const body: Record<string, any> = {
      customerId,
      number: invoiceNumber || nextInvoiceNumber(),
      amount: amountNumber,
      currency: "EUR",
      issueDate: issueISO,
      status: "DRAFT",
    }
    if (dueISO) body.dueDate = dueISO
    if (sendEmail) body.sendEmailOnCreate = true

    try {
      setLoading(true)
      const res = await authFetch(`/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText)
        throw new Error(msg || "Error al crear la factura")
      }
      toast.success("Factura creada", { description: "Guardada como borrador." })
      reset()
      setOpen(false)
      onCreated?.()
    } catch (e: any) {
      console.error("[invoices] create error →", e)
      let msg = e?.message ?? "No se pudo crear la factura"
      try {
        const parsed = JSON.parse(msg)
        if (parsed?.message) msg = Array.isArray(parsed.message) ? parsed.message.join(" · ") : String(parsed.message)
      } catch {}
      toast.error("No se pudo crear la factura", { description: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" />Nueva factura</Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Crear factura</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label>Cliente</Label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">Selecciona…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {customers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay clientes o no tienes permisos para verlos.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Número</Label>
            <Input
              placeholder="INV-20250929-ABCD"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Fecha de emisión</Label>
              <Input type="date" value={issuedOn} onChange={(e)=>setIssuedOn(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Vencimiento</Label>
              <Input type="date" value={dueOn} onChange={(e)=>setDueOn(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Importe (€)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e)=>setAmount(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border p-3">
            <div>
              <div className="font-medium">Enviar por email al crear</div>
              <div className="text-sm text-muted-foreground">Usa la plantilla por defecto de tu marca</div>
            </div>
            <Switch checked={sendEmail} onCheckedChange={setSendEmail} />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { reset(); setOpen(false) }}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={loading}>
              {loading ? "Creando…" : "Crear"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/* ----------------------- Filters Bar ----------------------- */
function FiltersBar({
  value,
  onChange,
}: {
  value: URLSearchParams
  onChange: (next: URLSearchParams) => void
}) {
  const set = (k: string, v?: string) => {
    const next = new URLSearchParams(value.toString())
    if (v === undefined) next.delete(k)
    else next.set(k, v)
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end">
      {/* Móvil: 1 columna. md+: 4 columnas fijas: auto 12rem 12rem 12rem */}
      <div className="grid flex-1 min-w-0 grid-cols-1 gap-3 md:[grid-template-columns:auto_12rem_12rem_12rem]">
        <div className="space-y-1">
          <Label htmlFor="from">Desde</Label>
          <Input
            id="from"
            type="date"
            className="w-full"
            value={value.get("from") ?? ""}
            onChange={(e) => set("from", e.target.value || undefined)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="to">Hasta</Label>
          <Input
            id="to"
            type="date"
            className="w-full"
            value={value.get("to") ?? ""}
            onChange={(e) => set("to", e.target.value || undefined)}
          />
        </div>

        <div className="space-y-1">
          <Label id="sort-label">Ordenar</Label>
          <Select
            value={value.get("sort") ?? "createdAt:desc"}
            onValueChange={(v) => set("sort", v)}
          >
            <SelectTrigger className="w-full" aria-labelledby="sort-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt:desc">Recientes</SelectItem>
              <SelectItem value="createdAt:asc">Antiguas</SelectItem>
              <SelectItem value="amountCents:desc">Importe ↓</SelectItem>
              <SelectItem value="amountCents:asc">Importe ↑</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-2 md:ml-auto">
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => onChange(new URLSearchParams())}
        >
          <Trash2 className="h-4 w-4" />
          Limpiar
        </Button>
      </div>
    </div>
  )
}

/* ----------------------- Edit & Delete dialogs ----------------------- */
function EditInvoiceDialog({
  inv,
  onSaved,
  trigger,
}: {
  inv: Invoice
  onSaved: () => void
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [number, setNumber] = useState(inv.id) 
  const [issuedOn, setIssuedOn] = useState(inv.createdAt.slice(0,10))
  const [dueOn, setDueOn] = useState("")
  const [amount, setAmount] = useState(String((inv.amountCents/100).toFixed(2)))
  const [status, setStatus] = useState<InvoiceStatus>(inv.status)

  async function handleSave() {
    try {
      setSaving(true)

      const amt = Number(String(amount).replace(",", "."))
      if (!Number.isFinite(amt) || amt < 0) {
        toast.error("Importe inválido")
        setSaving(false)
        return
      }

      const body: any = {
        number,
        amount: amt,
        issueDate: new Date(issuedOn || inv.createdAt).toISOString(),
        status,
      }
      if (dueOn) body.dueDate = new Date(dueOn).toISOString()

      const r = await updateInvoice(inv.id, body)
      if (!r.ok) throw new Error(r.msg)

      toast.success("Factura actualizada")
      setOpen(false)
      onSaved()
    } catch (e: any) {
      toast.error("Error al actualizar", { description: e?.message || "" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar factura</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Número</Label>
            <Input value={number} onChange={(e)=>setNumber(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Emisión</Label>
              <Input type="date" value={issuedOn} onChange={(e)=>setIssuedOn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Vencimiento</Label>
              <Input type="date" value={dueOn} onChange={(e)=>setDueOn(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Importe (€)</Label>
            <Input type="number" step="0.01" min="0" value={amount} onChange={(e)=>setAmount(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label>Estado</Label>
            <Select value={status} onValueChange={(v)=>setStatus(v as InvoiceStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DRAFT">Borrador</SelectItem>
                <SelectItem value="SENT">Enviada</SelectItem>
                <SelectItem value="PAID">Pagada</SelectItem>
                <SelectItem value="VOID">Anulada</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={()=>setOpen(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteInvoiceDialog({
  id,
  onDeleted,
  trigger,
}: {
  id: string
  onDeleted: () => void
  trigger: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)

  async function handleDelete() {
    setLoading(true)
    try {
      const res = await authFetch(`/invoices/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(await parseErrorText(res))
      toast.success("Factura eliminada")
      setOpen(false)
      onDeleted()
    } catch (e: any) {
      toast.error("Error al eliminar", { description: e?.message || "" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v)=> !loading && setOpen(v)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Eliminar factura?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Esta acción no se puede deshacer.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={loading}>
            {loading ? "Procesando…" : "Eliminar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ----------------------- Table ----------------------- */
function InvoicesTable({
  data,
  loading,
  onCreated,
}: {
  data: Invoice[]
  loading: boolean
  onCreated: () => void
}) {
  return (
    <div className="overflow-hidden rounded-2xl border">
      <div className="hidden grid-cols-12 gap-4 bg-muted/50 px-4 py-3 text-xs font-medium text-muted-foreground md:grid">
        <div className="col-span-4">Cliente</div>
        <div className="col-span-2">Fecha</div>
        <div className="col-span-2">Estado</div>
        <div className="col-span-1">Importe</div>
        <div className="col-span-3 text-right">Acciones</div>
      </div>
      <div className="divide-y">
        <AnimatePresence initial={false}>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <motion.div key={`skeleton-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-1 gap-3 p-4 md:grid-cols-12 md:items-center md:gap-4">
                <div className="col-span-4 h-4 animate-pulse rounded bg-muted" />
                <div className="col-span-2 h-4 animate-pulse rounded bg-muted" />
                <div className="col-span-2 h-6 w-24 animate-pulse rounded-full bg-muted" />
                <div className="col-span-1 h-4 animate-pulse rounded bg-muted" />
                <div className="col-span-3 h-8 w-24 animate-pulse rounded bg-muted md:ml-auto" />
              </motion.div>
            ))
          ) : data.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mb-2 text-lg font-semibold">No hay facturas</div>
              <div className="text-sm text-muted-foreground">Crea tu primera factura para empezar a cobrar.</div>
              <div className="mt-4 flex justify-center"><CreateInvoiceDrawer onCreated={onCreated} /></div>
            </div>
          ) : (
            data.map((inv) => <InvoiceRow key={inv.id} inv={inv} onMutate={onCreated} />)
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function safeCustomerName(inv: any) {
  const raw =
    inv?.customer?.name ||
    inv?.customerName ||
    inv?.customer_name ||
    inv?.customer?.email ||
    ""

  const n = String(raw).trim()
  return n || `Cliente #${String(inv?.id ?? "").slice(0, 8)}`
}

function InvoiceRow({ inv, onMutate }: { inv: Invoice; onMutate: () => void }) {
  const name = safeCustomerName(inv)
  const Meta = statusMeta(inv.status)
  const Icon = Meta.icon

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="grid grid-cols-1 gap-3 p-4 md:grid-cols-12 md:items-center md:gap-4"
    >
      <div className="col-span-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted font-medium">
            {initialsFromName(name)}
          </div>
          <div>
            <div className="font-medium leading-tight">{name}</div>
          </div>
        </div>
      </div>

      <div className="col-span-2 text-sm text-muted-foreground">
        {new Date(inv.createdAt).toLocaleDateString()}
      </div>
      <div className="col-span-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${Meta.className}`}>
          <Icon className="h-3.5 w-3.5" />{Meta.label}
        </span>
      </div>
      <div className="col-span-1 font-semibold">{formatCurrencyCents(inv.amountCents)}</div>

      <div className="col-span-3 md:ml-auto">
        {/* Editar */}
        <EditInvoiceDialog
          inv={inv}
          onSaved={onMutate}
          trigger={
            <Button variant="ghost" size="icon" aria-label="Editar">
              <Edit className="h-4 w-4" />
            </Button>
          }
        />

        {/* Eliminar con confirmación (solo DRAFT) */}
        <DeleteInvoiceDialog
          id={inv.id}
          onDeleted={onMutate}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Eliminar"
              disabled={inv.status !== "DRAFT"}
              title={inv.status !== "DRAFT" ? "Solo se pueden borrar borradores" : undefined}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          }
        />
      </div>
    </motion.div>
  )
}

/* ----------------------- KPI Cards ----------------------- */
function KpiCards({ data }: { data: Invoice[] }) {
  const sum = (arr: Invoice[]) => arr.reduce((a, b) => a + (Number(b.amountCents) || 0), 0)
  const total = sum(data)
  const paid = sum(data.filter(i => i.status === "PAID"))
  const outstanding = total - paid

  const CardStat = ({ title, value, sub }: { title: string; value: string; sub?: string }) => (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-semibold leading-none tracking-tight">{value}</div>
          {sub && <Badge variant="secondary" className="rounded-full">{sub}</Badge>}
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <CardStat title="Ingresos totales" value={formatCurrencyCents(paid)} sub="pagado" />
      <CardStat title="Pendiente de cobro" value={formatCurrencyCents(outstanding)} />
      <CardStat title="Facturado (mes)" value={formatCurrencyCents(total)} />
    </div>
  )
}

/* ----------------------- Main Page ----------------------- */
export default function AttractiveInvoicesPage() {
  const [params, setParams] = useState(() => new URLSearchParams([["sort","createdAt:desc"]]))

  const [qInput, setQInput] = useState("")
  const [query, setQuery]   = useState("")

  useEffect(() => {
    const t = setTimeout(() => {
      const nextQuery = qInput.trim()
      setQuery(nextQuery)

      setParams(prev => {
        const next = new URLSearchParams(prev.toString())
        next.set("page", "0")
        return next
      })
    }, 300)
    return () => clearTimeout(t)
  }, [qInput])

  const [loading, setLoading] = useState(true)
  const [resp, setResp] = useState<ListResponse>({ items: [], total: 0, page: 0, pageSize: 25 })

  const bumpFetch = () => {
    const next = new URLSearchParams(params.toString())
    next.set("_", String(Date.now()))
    setParams(next)
  }

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      try {
        const search = new URLSearchParams(params.toString())
        if (query) search.set("q", query)
        const res = await authFetch(`/invoices?${search.toString()}`)
        if (!res.ok) throw new Error("Error cargando facturas")
        const txt = await res.text()
        const json = txt ? JSON.parse(txt) : {}
        const normalized = normalizeInvoicesResponse(json)
        if (!cancelled) setResp(normalized)
      } catch (e) {
        console.error("[invoices] list error →", e)
        if (!cancelled) setResp({ items: [], total: 0, page: 0, pageSize: 25 })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [params, query])

  const shownItems = useMemo(() => {
    const s = query.trim().toLowerCase()
    if (!s) return resp.items
    return resp.items.filter(it => {
      const name = safeCustomerName(it).toLowerCase()
      const id   = String(it.id || "").toLowerCase()
      const num  = String((it as any).number || "").toLowerCase()
      return name.includes(s) || id.includes(s) || num.includes(s)
    })
  }, [resp.items, query])

  return (
    <div className="grid min-h-screen grid-cols-1 bg-background text-foreground md:grid-cols-[256px_minmax(0,1fr)]">
      <Sidebar />
      <div className="flex min-h-screen flex-col">
        <Header value={qInput} onSearch={setQInput} />
        <main className="mx-auto w-full max-w-screen-2xl min-w-0 flex-1 space-y-6 px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Facturas</h1>
              <p className="text-sm text-muted-foreground">Gestiona, filtra y cobra con estilo ✨</p>
            </div>
            <div className="hidden md:block"><CreateInvoiceDrawer onCreated={bumpFetch} /></div>
          </div>

          <KpiCards data={resp.items} />

          <Card>
            <CardContent className="space-y-4 pt-6">
              <FiltersBar value={params} onChange={setParams} />
            </CardContent>
          </Card>

          <Tabs defaultValue={params.get("status") ?? "all"} onValueChange={(v)=>{
            const next = new URLSearchParams(params.toString())
            if (v === "all") next.delete("status")
            else next.set("status", v)
            setParams(next)
          }}>
            <TabsList>
              <TabsTrigger value="all">Todas</TabsTrigger>
              <TabsTrigger value="PAID">Pagadas</TabsTrigger>
              <TabsTrigger value="SENT">Enviadas</TabsTrigger>
              <TabsTrigger value="DRAFT">Borradores</TabsTrigger>
            </TabsList>

            {/* usar shownItems */}
            <TabsContent value="all" className="mt-4">
              <InvoicesTable data={shownItems} loading={loading} onCreated={bumpFetch} />
            </TabsContent>
            <TabsContent value="PAID" className="mt-4">
              <InvoicesTable data={shownItems.filter(i=>i.status==="PAID")} loading={loading} onCreated={bumpFetch} />
            </TabsContent>
            <TabsContent value="SENT" className="mt-4">
              <InvoicesTable data={shownItems.filter(i=>i.status==="SENT")} loading={loading} onCreated={bumpFetch} />
            </TabsContent>
            <TabsContent value="DRAFT" className="mt-4">
              <InvoicesTable data={shownItems.filter(i=>i.status==="DRAFT")} loading={loading} onCreated={bumpFetch} />
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {resp.total > 0 && (
                <>Mostrando <span className="font-medium">{shownItems.length}</span> de <span className="font-medium">{resp.total}</span></>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={()=>{
                const next = new URLSearchParams(params.toString())
                const p = Number(next.get("page") ?? 0)
                next.set("page", String(Math.max(0, p-1)))
                setParams(next)
              }}>Anterior</Button>
              <Button variant="outline" size="sm" onClick={()=>{
                const next = new URLSearchParams(params.toString())
                const p = Number(next.get("page") ?? 0)
                next.set("page", String(p+1))
                setParams(next)
              }}>Siguiente</Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
