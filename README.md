# SaaS Multi-Tenant: Invoices-Lite (Next.js + NestJS)

Aplicación ligera de facturación con **frontend Next.js** y **API NestJS**, diseñada para escenarios **multi-tenant** (un backend, múltiples organizaciones/tenants) con autenticación por JWT y refresco por cookies.

## 📈 Objetivo

Gestionar facturas y clientes de forma sencilla:

- Listado filtrable y con búsqueda de **facturas**
- **CRUD** de facturas y clientes
- Estados: **DRAFT**, **SENT**, **PAID**, **VOID**
- KPIs básicos (facturado, pendiente, etc.)
- Interfaz moderna (Radix + Tailwind) con **diálogos** de edición y confirmación

---

## 🤖 Tecnologías utilizadas

- **Frontend**: Next.js 14 (App Router), React 18, Radix UI Primitives, Tailwind CSS, Framer Motion, Lucide Icons, Sonner (toasts)
- **Backend**: NestJS, Prisma ORM
- **Base de datos**: PostgreSQL
- **Cache/cola (opcional)**: Redis
- **Auth**: JWT (access) + cookie de **refresh**; endpoints `/auth/login` y `/auth/refresh`
- **Multi-tenant**: middleware que propaga un `tenantId` (por cabecera/host) a Prisma

---

## 📂 Estructura de carpetas

```
SaaS multi-tenant/
└─ invoices-lite/
   ├─ apps/
   │  ├─ api/                       # NestJS (REST)
   │  └─ web/                       # Next.js 14 (App Router)
   ├─ prisma/                       # Esquema y migraciones compartidas
   ├─ docker-compose.yml            # PostgreSQL + Redis para desarrollo
   ├─ package.json                  # Workspace (pnpm)
   └─ pnpm-lock.yaml
```

> La UI incluye: barra de **búsqueda** (cliente o nº de factura), **filtros** por fecha y orden, **tabs** por estado, **drawer** de “Nueva factura”, **diálogo de edición** y **diálogo de borrado**.

---

## ⚙️ 1. Puesta en marcha (desarrollo)

### Requisitos

- Node.js 18+  
- **pnpm** 9.x  
- Docker (opcional, para levantar Postgres/Redis rápidamente)

### Opción A — con Docker (recomendada)

```bash
cd "SaaS multi-tenant/invoices-lite"
docker compose up -d   # levanta postgres:5432 y redis:6379
```

### Opción B — sin Docker

Instala PostgreSQL y (opcional) Redis en local y arráncalos.

---

## 🔐 2. Variables de entorno

Crea los ficheros:

**`apps/api/.env`**
```
# PostgreSQL
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/invoices"

# JWT
JWT_ACCESS_SECRET="dev_access_secret_please_change"
JWT_REFRESH_SECRET="dev_refresh_secret_please_change"

# Cookies
COOKIE_DOMAIN=localhost
COOKIE_SECURE=false

# Redis (opcional)
REDIS_URL="redis://localhost:6379"

# Multi-tenant (de ejemplo)
DEFAULT_TENANT="acme"
```

**`apps/web/.env.local`**
```
# URL de la API (el frontend también detecta window.location:3001 si no se define)
NEXT_PUBLIC_API_URL="http://localhost:3001"
```

---

## 🛠️ 3. Instalación, BD y arranque

En el **directorio `invoices-lite`**:

```bash
# instalar dependencias del workspace
pnpm i

# preparar Prisma (si fuera necesario)
# pnpm -w add prisma @prisma/client    # solo si no estuvieran en el lockfile
# npx prisma generate
# npx prisma migrate dev

# arrancar API y Web en paralelo
pnpm dev
#  - API: http://localhost:3001
#  - Web: http://localhost:3000
```

> El workspace define scripts como:
>
> - `pnpm dev` → ejecuta `pnpm dev:api` y `pnpm dev:web` en paralelo  
> - `pnpm dev:api` → `@app/api` (NestJS)  
> - `pnpm dev:web` → `@app/web` (Next.js)

---

## 👤 4. Autenticación inicial

1) Registra un usuario (una sola vez):

```bash
curl -X POST http://localhost:3001/auth/register   -H "Content-Type: application/json"   -d '{"email":"admin@acme.test","password":"changeme"}'
```

2) Inicia sesión desde la UI: `http://localhost:3000/login`  
La API emitirá un **access token** (uso interno) y una cookie de **refresh**.

---

## 🧩 5. Multi-tenancy (concepto)

- La API resuelve el **tenant** (por ejemplo `acme`) desde cabecera/host.  
- Prisma recibe el `tenantId` vía middleware/servicio para **aislar datos**.  
- Ejemplo de uso vía cURL:

```bash
curl http://localhost:3001/invoices   -H "x-tenant-id: acme"   --cookie "refresh_token=..."   # cookie tras login
```

> En desarrollo, la UI ya llama a la API con el tenant por defecto (p. ej. `acme`).

---

## 🔗 6. Endpoints principales (API)

- **Auth**
  - `POST /auth/login` – email + password → set cookie refresh + access json
  - `POST /auth/refresh` – renueva access token con cookie de refresh
  - `POST /auth/logout`
  - `POST /auth/register` – alta básica (desarrollo)

- **Clientes**
  - `GET /customers` (query `q`, `limit`)  
  - `POST /customers`  
  - `PATCH /customers/:id`  
  - `DELETE /customers/:id`

- **Facturas**
  - `GET /invoices` (query `q`, `from`, `to`, `sort`, `page`)  
  - `POST /invoices`  
  - `PATCH /invoices/:id` *(la UI hace fallback a PUT si el backend no soporta PATCH)*  
  - `DELETE /invoices/:id` *(solo borradores)*

---

## 🖥️ 7. UI destacada

- **Búsqueda** global de cliente / nº de factura (debounce)
- **Filtros** por fecha y orden (createdAt/amount)
- **Tabs** por estado (Todas, Pagadas, Enviadas, Borradores)
- **KPIs** (total pagado, pendiente, etc.)
- **CreateInvoiceDrawer** (sheet) con selección de cliente y envío opcional por email
- **EditInvoiceDialog** con normalización de campos y manejo de errores del backend
- **authFetch** con **auto-refresh** de sesión (reintenta tras `401`)

---

## 🚀 8. Despliegue (sugerencias)

- **Frontend**: Vercel / Netlify  
- **API**: Render, Fly.io, Railway, u otros  
- **PostgreSQL**: Neon, Supabase, RDS, etc.  
- **Redis** (opcional): Upstash/Valkey

> GitHub Pages **no** es adecuado para Next.js con API.

---

## ✍️ Autor

Desarrollado por **Moisés Herrada Díaz**.  
Contacta por GitHub o email para soporte y colaboraciones.

---

## 🧾 **Licencia:** [MIT](./LICENSE)
