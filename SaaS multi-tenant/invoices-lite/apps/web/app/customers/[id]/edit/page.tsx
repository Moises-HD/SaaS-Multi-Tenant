import { notFound, redirect } from 'next/navigation';
import CustomerForm from '../../../components/CustomerForm';

async function requireAuth() {
  const r = await fetch('/api/auth/me', { cache: 'no-store' });
  if (r.status === 401) redirect('/login');
}

async function getCustomer(id: string) {
  const r = await fetch(`/api/customers/${id}`, { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Error al cargar el customer');
  return r.json();
}

export default async function EditCustomerPage({ params }: { params: { id: string } }) {
  await requireAuth();
  const customer = await getCustomer(params.id);
  if (!customer) notFound();

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Editar Customer</h1>
      <CustomerForm
        mode="edit"
        initial={{ id: customer.id, name: customer.name, email: customer.email }}
      />
    </section>
  );
}
