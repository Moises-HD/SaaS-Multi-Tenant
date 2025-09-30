"use client"

import { LayoutDashboard } from "lucide-react"
import { ComingSoon } from "@/components/ui/Coming-soon"

export default function PanelPage() {
  return (
    <main className="w-full max-w-screen-xl mx-auto px-4 py-8">
      <ComingSoon
        title="Panel"
        subtitle="Un vistazo rápido a tus KPIs y atajos de trabajo."
        Icon={LayoutDashboard}
        features={[
          "KPIs de ingresos, morosidad y facturación",
          "Atajos a acciones frecuentes",
          "Widgets personalizables",
        ]}
      />
    </main>
  )
}
