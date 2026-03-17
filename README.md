# 🚀 SaaS Multi-Tenant: Invoices-Lite (Next.js + NestJS)

Lightweight invoicing SaaS application built with **Next.js (frontend)** and **NestJS (backend API)**, designed using a **multi-tenant architecture** (single backend serving multiple organizations).

Supports secure authentication using **JWT (access tokens)** and **refresh tokens via cookies**, with tenant-based data isolation.

---

## 🎯 Overview

This project demonstrates how to build a scalable, production-ready SaaS platform with:

- Multi-tenant data isolation  
- Secure authentication flows  
- Modern UI/UX  
- Modular backend architecture  

---

## ✨ Features

- 📄 Invoice and customer management (full CRUD)  
- 🔍 Search, filtering, and sorting  
- 📊 Basic KPIs (paid, pending, totals)  
- 🧾 Invoice states: **DRAFT, SENT, PAID, VOID**  
- 🔐 JWT authentication + refresh tokens  
- 🏢 Multi-tenant architecture  
- 🎨 Modern UI (Radix UI + Tailwind + Framer Motion)  

---

## 🧰 Tech Stack

**Frontend**
- Next.js 14 (App Router)
- React 18
- Tailwind CSS
- Radix UI
- Framer Motion
- Lucide Icons
- Sonner (toasts)

**Backend**
- NestJS
- Prisma ORM

**Infrastructure**
- PostgreSQL
- Redis (optional)
- Docker (development)

---

## 🏗️ Architecture

```
SaaS multi-tenant/
└─ invoices-lite/
   ├─ apps/
   │  ├─ api/     # NestJS backend
   │  └─ web/     # Next.js frontend
   ├─ prisma/     # Database schema & migrations
   ├─ docker-compose.yml
   └─ pnpm workspace
```

---

## ⚙️ Getting Started

### Requirements

- Node.js 18+
- pnpm
- Docker (optional)

---

### Run with Docker (recommended)

```bash
cd "SaaS multi-tenant/invoices-lite"
docker compose up -d
```

---

### Install & Run

```bash
pnpm install
pnpm dev
```

- Frontend: http://localhost:3000  
- API: http://localhost:3001  

---

## 🔐 Environment Variables

### Backend (`apps/api/.env`)

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/invoices
JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret
COOKIE_DOMAIN=localhost
COOKIE_SECURE=false
REDIS_URL=redis://localhost:6379
DEFAULT_TENANT=acme
```

### Frontend (`apps/web/.env.local`)

```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## 👤 Authentication

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`

---

## 🧩 Multi-Tenancy

- Tenant resolved via headers (e.g. `x-tenant-id`)
- Prisma middleware ensures data isolation
- Each request is scoped to a tenant

Example:

```bash
curl http://localhost:3001/invoices \
  -H "x-tenant-id: acme"
```

---

## 🔗 API Endpoints

### Customers
- GET /customers
- POST /customers
- PATCH /customers/:id
- DELETE /customers/:id

### Invoices
- GET /invoices
- POST /invoices
- PATCH /invoices/:id
- DELETE /invoices/:id

---

## 🖥️ UI Highlights

- Global search (debounced)
- Date filters & sorting
- Status tabs
- KPI dashboard
- Invoice creation drawer
- Edit dialogs
- Auto session refresh

---

## 🚀 Deployment

- Frontend: Vercel / Netlify  
- Backend: Render / Railway / Fly.io  
- Database: Neon / Supabase / AWS RDS  
- Redis: Upstash  

---

## 👨‍💻 Author

Moisés Herrada Díaz  
GitHub: https://github.com/Moises-HD  

---

## 📄 License

MIT License
