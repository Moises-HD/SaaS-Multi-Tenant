# Bienvenido 👋

Este repositorio reúne **dos proyectos complementarios** alrededor de las facturas:  
1) una **app web de facturación (SaaS ligero)** y  
2) un **proyecto de IA** que extrae datos clave de facturas en PDF.

La idea es que puedas **explorar**, **probar con tus credenciales** (si las tienes) y **entender el flujo** de punta a punta sin ahogarte en instrucciones técnicas aquí. Los detalles “paso a paso” están dentro de cada carpeta.

---

## 🧭 ¿Qué hay aquí?

### 1) App web de facturación (SaaS)
Una interfaz moderna para **listar, buscar, crear, editar y (si procede) eliminar** facturas. Pensado para ser claro y agradable de usar.

**Lo más destacable:**
- 🔎 **Búsqueda rápida** por cliente o número de factura.
- 🧮 **KPIs** sencillos (totales, pendientes, etc.).
- 🗂️ **Filtros y pestañas** por estado (Borrador, Enviada, Pagada).
- 📝 **Edición segura** (valida importes y fechas).
- 🧹 **Eliminación** restringida a borradores, con mensajes claros.
- 🎛️ **Diseño cuidado** (accesible, con modo claro/oscuro).

**Dónde está:** carpeta de la aplicación web dentro de `SaaS multi-tenant/invoices-lite/apps/web/`  
**Además**: hay una API en `SaaS multi-tenant/invoices-lite/apps/api/` que sirve los datos.

> Si tienes **credenciales**, podrás entrar y ver datos de ejemplo. Si no, igualmente puedes recorrer capturas de pantallas y componentes.

---

### 2) IA para facturas (OCR + T5)
Un proyecto que combina **OCR** con un modelo de lenguaje para **extraer automáticamente** información clave de facturas eléctricas (fechas, CUPS, consumo, importes…).

**Lo más destacable:**
- 📄 Lee PDFs y convierte el contenido en texto.
- 🏷️ Incluye herramientas para **etiquetar** ejemplos de forma fácil.
- 🧠 Entrena un modelo (T5) para **inferir campos**.
- ✅ Pensado para que puedas **repetir el proceso** con tus propios PDFs.

**Dónde está:** carpeta `Facturas-ML-OCR/`.  
Dentro encontrarás un README con los pasos técnicos (generar dataset, etiquetar, entrenar e inferir).

---

## 👀 Cómo explorar el repo (sin instalar nada)

- En GitHub, abre las carpetas desde la **página principal** del repo.
- Empieza por **`SaaS multi-tenant/invoices-lite/apps/web/`** para ver la app, sus páginas y componentes de UI.
- Luego entra en **`Facturas-ML-OCR/`** para leer el README propio con los detalles del flujo de IA.
- Si quieres una **visión rápida**, hojea:
  - `app/invoices/page.tsx` (lista y acciones de facturas).
  - `components/ui/` (botones, diálogos, etc.).
  - En IA, los scripts con nombres autoexplicativos (`generar_dataset.py`, `etiquetador.py`, `inferir_factura.py`, …).

> Cuando quieras ejecutar algo de verdad, cada carpeta tiene su **README técnico** con instrucciones. Aquí solo te damos el mapa.

---

## 🔐 Notas de privacidad y tamaño

- El proyecto de IA **no incluye datos reales** ni el modelo pesado por defecto.  
  Si entrenas el tuyo, recuerda **no subir** datos sensibles ni modelos de varios GB al repo.
- En la app web hay **mensajes claros** cuando alguna acción no está permitida (por permisos o estado de la factura).

---

## 📌 Estado del proyecto

Esto es un **work in progress** bien encaminado:
- La app web ya permite el ciclo básico de facturas con una UX pulida.
- La parte de IA está lista para **probar el pipeline** de extracción con tus documentos.

Se aceptan sugerencias y mejoras ✨

---

## 🤝 Autor y contacto

**Moisés Herrada Díaz**  
Si te interesa colaborar o tienes dudas, mandar un mail a "moises.herrada.diaz@gmail.com" o contáctame por **GitHub**.

---

## 📄 Licencia

Este repositorio se publica bajo **MIT**. Úsalo libremente con atribución.
