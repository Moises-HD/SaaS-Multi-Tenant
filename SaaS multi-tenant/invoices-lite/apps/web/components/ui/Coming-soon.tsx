"use client"

import * as React from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type IconType = React.ComponentType<React.SVGProps<SVGSVGElement>>

export function ComingSoon({
  title,
  subtitle,
  features,
  Icon,
  backHref = "/invoices",
  backLabel = "Volver a facturas",
}: {
  title: string
  subtitle?: string
  features?: string[]
  Icon?: IconType
  backHref?: string
  backLabel?: string
}) {
  return (
    <div className="relative mx-auto w-full max-w-screen-xl overflow-hidden rounded-3xl border bg-gradient-to-br from-background to-muted/60 p-8 sm:p-12">
      <motion.div
        aria-hidden
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 0.6, scale: 1 }}
        transition={{ duration: 0.8 }}
        className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-primary/20 blur-3xl"
      />
      <motion.div
        aria-hidden
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 0.6, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.1 }}
        className="pointer-events-none absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-emerald-400/20 dark:bg-emerald-500/20 blur-3xl"
      />

      <div className="relative z-10 grid gap-8 sm:grid-cols-[1fr_320px] sm:items-center">
        <div className="space-y-4">
          <Badge className="rounded-full">Próximamente</Badge>
          <div className="flex items-start gap-3">
            {Icon ? (
              <motion.div
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 18 }}
                className="mt-1 rounded-xl bg-primary/10 p-2"
              >
                <Icon className="h-6 w-6" />
              </motion.div>
            ) : null}
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
              {subtitle ? (
                <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
          </div>

          {features?.length ? (
            <ul className="mt-4 grid gap-2 text-sm">
              {features.map((f, i) => (
                <motion.li
                  key={f}
                  initial={{ x: -8, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.05 * i }}
                  className="flex items-center gap-2"
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/70" />
                  <span className="text-muted-foreground">{f}</span>
                </motion.li>
              ))}
            </ul>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2">
            <Link href={backHref}>
              <Button variant="default">{backLabel}</Button>
            </Link>
            <Button
              variant="outline"
              onClick={() =>
                (window as any).__toast?.info?.("Gracias por tu interés ❤️")
              }
            >
              Avísame cuando esté listo
            </Button>
          </div>
        </div>

        <motion.div
          initial={{ rotate: -4, y: 12, opacity: 0 }}
          animate={{ rotate: 0, y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 18 }}
          className="rounded-2xl border bg-background p-6 shadow-sm"
        >
          <div className="mb-3 h-3 w-24 rounded-full bg-muted" />
          <div className="mb-4 h-3 w-36 rounded-full bg-muted" />
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl bg-muted" />
                <div className="h-3 w-full rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="mt-5 h-10 w-full rounded-xl bg-muted" />
        </motion.div>
      </div>
    </div>
  )
}
