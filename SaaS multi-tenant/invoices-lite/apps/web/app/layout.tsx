import "./globals.css"
import NavBar from "./components/NavBar"
import { Toaster } from "sonner"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-gray-50 text-gray-900">
        <NavBar />
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <Toaster richColors closeButton />
      </body>
    </html>
  )
}
