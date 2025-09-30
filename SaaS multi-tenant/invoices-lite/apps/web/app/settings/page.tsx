"use client"

import { Settings } from "lucide-react"
import { ComingSoon } from "@/components/ui/Coming-soon"

export default function SettingsPage() {
  return (
    <main className="w-full max-w-screen-xl mx-auto px-4 py-8">
      <ComingSoon
        title="Ajustes"
        subtitle="Configura tu marca, plantillas y preferencias."
        Icon={Settings}
        features={[
          "Branding (logo, colores y datos fiscales)",
          "Plantillas de email y PDF",
          "Usuarios y permisos",
        ]}
      />
    </main>
  )
}
