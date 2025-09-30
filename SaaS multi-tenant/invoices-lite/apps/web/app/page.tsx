import Link from "next/link";

export default function Home() {
  return (
    <main className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Demo SaaS</h1>
      <div className="space-x-4">
        <a className="underline" href="/customers">Clientes</a>
        <a className="underline" href="/invoices">Facturas</a>
        <a className="underline" href="/login">Login</a>
      </div>
    </main>
  );
}

