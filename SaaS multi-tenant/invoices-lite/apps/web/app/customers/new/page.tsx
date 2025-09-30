import { redirect } from 'next/navigation';
import CustomerForm from '../../components/CustomerForm';

async function requireAuth() {
  const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/auth/me`, {
    cache: 'no-store',
  });
  if (r.status === 401) redirect('/login');
}

export default async function NewCustomerPage() {
  await requireAuth();

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Nuevo Customer</h1>
      <CustomerForm mode="create" />
    </section>
  );
}
