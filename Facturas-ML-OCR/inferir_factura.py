# -*- coding: utf-8 -*-
import sys, json, torch, re, os, tempfile, unicodedata
from datetime import datetime
from PIL import Image, ImageOps, ImageFilter
import fitz
import time

from doctr.io import DocumentFile
from doctr.models import ocr_predictor
from transformers import T5ForConditionalGeneration, T5Tokenizer

MODEL_DIR = "./t5_factura_base_model"
CAMPOS = ["fechaDesde","fechaHasta","cups","consumo","euroConsumo","total","excesoPotencia"]

# =========================================================
# Utilidades de depuración
# =========================================================
def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip() in ("1", "true", "True")

def _debug_enabled() -> bool:
    return _env_flag("DEBUG_EURO")

def dprint(*args, **kwargs):
    if _debug_enabled():
        print("[DEBUG_EURO]", *args, **kwargs)

def snippet_around(txt: str, start: int, end: int, span: int = 120) -> str:
    a = max(0, start - span)
    b = min(len(txt), end + span)
    return txt[a:b].replace("\n", " ")

# =========================================================
# Helpers de salida segura
# =========================================================
def _empty_out():
    return {k: "" for k in CAMPOS}

# =========================
# OCR (con fallback embebido + heurística Naturgy)
# =========================
def _quality_score(text: str) -> float:
    if not text:
        return 0.0
    low = text.lower()
    keys = ["kwh", "consumo", "importe", "total", "periodo", "cups"]
    score = sum(1 for k in keys if k in low)
    score += min(len(text) / 4000.0, 2.0)  # +0..2 por volumen
    return float(score)

def _looks_like_naturgy(text: str) -> bool:
    low = text.lower()
    return ("concepto" in low and "cantidad" in low and "precio unitario" in low) or ("naturgy" in low)

def ocr_pdf_to_text(pdf_path):
    cand = []  
    try:
        doc = fitz.open(pdf_path)
        embedded = []
        for page in doc:
            embedded.append(page.get_text("text"))
        embedded_text = "\n".join(s.strip() for s in embedded if s and s.strip())
        embedded_text = "\n".join(l.strip() for l in embedded_text.splitlines() if l.strip())
    except Exception:
        embedded_text = ""

    emb_score = _quality_score(embedded_text)
    if embedded_text:
        cand.append(("embedded", embedded_text, emb_score))

    force_try_raster = False
    if embedded_text:
        low = embedded_text.lower()
        has_eur_word = (" eur" in low or "eur " in low)
        has_euro_symbol = ("€" in embedded_text)
        if emb_score < 4.0 or (_looks_like_naturgy(embedded_text) and has_eur_word and not has_euro_symbol):
            force_try_raster = True
    else:
        force_try_raster = True

    if force_try_raster:
        best_raster_text = ""
        best_raster_score = -1.0
        try:
            for zoom in (3.2, 3.8):
                doc = fitz.open(pdf_path)
                mat = fitz.Matrix(zoom, zoom)
                tmpdir = tempfile.TemporaryDirectory()
                png_paths = []

                for i, page in enumerate(doc):
                    pix = page.get_pixmap(matrix=mat, alpha=False)
                    if pix.width < 32 or pix.height < 32:
                        continue
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    img = ImageOps.grayscale(img)
                    img = ImageOps.autocontrast(img)
                    img = img.filter(ImageFilter.SHARPEN)

                    # Evitar imágenes gigantes
                    max_side = 4500
                    w, h = img.size
                    if max(w, h) > max_side:
                        scale = max_side / float(max(w, h))
                        img = img.resize((int(w*scale), int(h*scale)), Image.BILINEAR)

                    out_path = os.path.join(tmpdir.name, f"page_{i+1:03d}.png")
                    img.save(out_path, format="PNG")
                    png_paths.append(out_path)

                if not png_paths:
                    continue

                docfile = DocumentFile.from_images(png_paths)
                ocr = ocr_predictor(pretrained=True, assume_straight_pages=True)
                result = ocr(docfile)

                lines = []
                for page in result.pages:
                    for block in page.blocks:
                        for line in block.lines:
                            lines.append(" ".join(w.value for w in line.words))

                full_text = "\n".join(lines).replace("\xa0"," ").replace("\t"," ").strip()
                full_text = "\n".join(l.strip() for l in full_text.splitlines() if l.strip())
                sc = _quality_score(full_text)

                # Nos quedamos con el mejor raster
                if sc > best_raster_score:
                    best_raster_score = sc
                    best_raster_text = full_text
        except Exception:
            best_raster_text = ""
            best_raster_score = -1.0

        if best_raster_text:
            cand.append(("ocr", best_raster_text, best_raster_score))

    # --- 3) Elegir mejor candidato
    if not cand:
        return ""

    cand.sort(key=lambda x: (x[2], len(x[1])), reverse=True)
    best_source, best_text, best_score = cand[0]

    if len(best_text) < 50:
        for src, txt, sc in cand:
            if src == "embedded" and len(txt) >= 50:
                return txt

    return best_text

# =========================
# Parsing y normalización
# =========================
def extract_json_block(s: str) -> str:
    m = re.search(r"\{.*\}", s, re.DOTALL)
    if not m:
        raise ValueError("No JSON found")
    return re.sub(r",\s*([}\]])", r"\1", m.group(0))

def normalize_out(out: dict) -> dict:
    out["cups"] = (out.get("cups","") or "").replace(" ", "").upper()
    for k in ("fechaDesde","fechaHasta"):
        out[k] = (out.get(k,"") or "").replace(".", "/")
    return out

def parse_target(texto: str) -> dict:
    try:
        obj = json.loads(extract_json_block(texto))
        if isinstance(obj, dict):
            return normalize_out({k: obj.get(k,"") for k in CAMPOS})
    except Exception:
        pass
    out = {k:"" for k in CAMPOS}
    for parte in texto.split(";"):
        if ":" in parte:
            k, v = parte.split(":", 1)
            k, v = k.strip(), v.strip()
            if k in out:
                out[k] = v
    return normalize_out(out)

# =========================
# Validadores y fallbacks
# =========================
CUPS_RE = re.compile(r"\bES[0-9A-Z]{18,24}\b")

def norm_date(s):
    s = (s or "").strip()
    if not s: return ""
    s = s.replace(".", "/").replace("-", "/")
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{2,4})$", s)
    if not m: return ""
    d, mth, y = m.groups()
    y = int(y)
    if y < 100: y += 2000
    try: return datetime(y, int(mth), int(d)).strftime("%d/%m/%Y")
    except ValueError: return ""

def parse_number_keep_decimals(s: str) -> str:
    if not s: return ""
    m = re.search(r"([\-−–]?\s*)(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\b", s)
    if not m: return ""
    sign, val = m.group(1), m.group(2)
    sign = "-" if sign.strip() in ("-", "−", "–") else ""
    val = val.replace(" ", "")
    if "." in val and "," in val:
        val = val.replace(".", "").replace(",", ".")
    else:
        val = val.replace(",", ".")
    return f"{sign}{val}"

def first_amount(s):
    s = s.replace("−", "-").replace("–", "-")
    m = re.search(r"(-?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d+)?|-?\s*\d+(?:[.,]\d+)?)", s)
    if not m:
        return ""
    val = m.group(1).replace(" ", "")
    if "." in val and "," in val:
        val = val.replace(".", "").replace(",", ".")
    elif "," in val and "." not in val:
        val = val.replace(",", ".")
    return val

NUM_RE = re.compile(r"^[\-\s]?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d+)?$|^[\-\s]?\d+(?:[.,]\d+)?$")

def parse_number_es(s: str):
    if not s:
        return None
    s = s.strip()
    if not NUM_RE.match(s):
        return None
    s = (s.replace("\u00A0"," ").replace("\u202f"," ")
           .replace("\u2009"," ").replace("\u2007"," "))
    s = s.replace(" ", "")
    if "." in s and "," in s:
        s = s.replace(".", "").replace(",", ".")
    else:
        if "," in s and "." not in s:
            s = s.replace(",", ".")
        elif "." in s and re.fullmatch(r"[\-\s]?\d{1,3}(?:\.\d{3})+", s):
            s = s.replace(".", "")
    try:
        return float(s)
    except:
        return None

def same_date(a: str, b: str) -> bool:
    return norm_date(a) == norm_date(b)

def same_number(a: str, b: str, tol: float = 0.01) -> bool:
    fa, fb = parse_number_es(a), parse_number_es(b)
    if fa is None or fb is None:
        return False
    return abs(fa - fb) < tol

EQUIV_PAT = re.compile(r"(equivalen\w*|1\s*gj\b|gj\s*=|kwh/m|m³|\bm3\b)", re.I)

def _is_equivalence_or_unit_line(s: str) -> bool:
    if not s:
        return False
    low = s.lower()
    if EQUIV_PAT.search(low):
        return True
    if "=" in low and "kwh" in low:
        return True
    return False

def find_consumo_kwh(ocr: str) -> str:
    """
    Extrae el total kWh tomando el número inmediatamente anterior a 'kWh'
    (permitiendo variantes 'k w h'), aunque haya precio unitario en la línea.
    Evita capturar precios unitarios (muchos decimales o valores muy pequeños).
    """
    best = None
    # kwh flexible: k \W* w \W* h  (espacios o signos entre letras)
    kwh_tok = re.compile(r"k\W*w\W*h", flags=re.I)

    for raw_line in ocr.splitlines():
        line = raw_line.replace("\xa0"," ")
        if _is_equivalence_or_unit_line(line):
            continue
        low = line.lower()
        if "reactiva" in low:
            continue

        # buscamos el token kwh y miramos el número justo antes
        for m_tok in kwh_tok.finditer(line):
            left = line[:m_tok.start()]
            # último número antes de kWh
            m_num = re.search(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})+|\-?\s*\d+(?:[.,]\d+)?)\s*$", left)
            if not m_num:
                continue
            val = m_num.group(1).replace(" ", "")
            # normaliza miles/decimales
            if "." in val and "," not in val and re.fullmatch(r"\-?\d{1,3}(?:\.\d{3})+", val):
                val = val.replace(".", "")
            elif "," in val and "." not in val:
                val = val.replace(",", ".")

            # evita precios unitarios: demasiados decimales o valor muy pequeño
            if _is_probably_unit_price(val):
                continue
            try:
                f = float(val)
                if f < 10:            # umbral suave para evitar 0.2, 3.5, etc.
                    continue
                if f > MAX_KWH_PER_PERIOD:
                    continue
                # elige el mayor razonable (suele ser el total del periodo)
                if (best is None) or (f > best[0]):
                    best = (f, val)
            except:
                pass

    return best[1] if best else ""


# ---------- Validación de euros (global, única) ----------
MIN_EUR_CONSUMO = float(os.environ.get("MIN_EUR_CONSUMO", "10"))

def _valid_eur(s, total_float=None, ocr0: str = ""):
    if not s:
        return False
    f = parse_number_es(s)
    if f is None:
        return False
    low = (ocr0 or "").lower()
    is_rect = ("rectifica" in low) or ("abono" in low)
    if total_float is not None and not is_rect:
        if total_float < 0 and f > 0: return False
        if total_float > 0 and f < 0: return False
    if abs(f) <= MIN_EUR_CONSUMO:  # magnitud mínima
        return False
    if total_float is not None and abs(total_float) > 0:
        if abs(f) > 1.10 * abs(total_float): return False
        if abs(f) < 0.10 * abs(total_float): return False
    return True

def find_negative_euro_energia(ocr: str) -> str:
    lines = (ocr.replace("\xa0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," ").splitlines())
    pat = re.compile(r"([\-−–]\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:€|eur)?\b", re.I)
    for ln in lines:
        low = ln.lower()
        if not any(k in low for k in ("energía","energia","término energía","termino energia","energía activa","energia activa")):
            continue
        if any(b in low for b in ("reactiva","cargos","acceso","potencia","exceso","servicio","alquiler","mantenimiento")):
            continue
        m = pat.search(ln)
        if m:
            return parse_number_keep_decimals(m.group(1))
    return ""


# ---------- Cordura precio por kWh ----------
MIN_PRICE_PER_KWH = float(os.environ.get("MIN_PRICE_PER_KWH", "0.02"))  
MAX_PRICE_PER_KWH = float(os.environ.get("MAX_PRICE_PER_KWH", "0.60"))  

def _price_ok(consumo_str: str, euro_consumo_str: str) -> bool:
    """True si euroConsumo/consumo ∈ [MIN_PRICE_PER_KWH, MAX_PRICE_PER_KWH]."""
    f_kwh = parse_number_es(consumo_str)
    f_eur = parse_number_es(euro_consumo_str)
    if f_kwh is None or f_eur is None or f_kwh <= 0:
        return True  # sin info suficiente, no bloqueamos
    p = f_eur / f_kwh
    return MIN_PRICE_PER_KWH <= p <= MAX_PRICE_PER_KWH

# ---------- Total kWh (tabla 'Total ... kWh') ----------
def find_total_kwh_from_table(ocr: str) -> str:
    """
    Detecta 'Total <número> kWh' evitando confusiones con reactiva/kVArh,
    pero SIN descartar 'potencia' ni 'exceso' que suelen ir al lado del total.
    """
    MAX_KWH_PER_PERIOD = float(os.environ.get("MAX_KWH_PER_PERIOD", "700000"))
    BAD_NEAR = ("reactiva", "kvarh", "kvar")

    txt = ocr
    for m in re.finditer(r"\bTotal\s+(\-?\s*\d{1,3}(?:[.\s]\d{3})+|\-?\s*\d+(?:[.,]\d+)?)\s*kwh\b", txt, flags=re.I):
        start, end = m.span()
        context = txt[max(0, start - 40): min(len(txt), end + 40)].lower()
        if any(b in context for b in BAD_NEAR):
            continue
        val = m.group(1).replace("\u00A0","").replace("\u202f","").replace("\u2009","").replace("\u2007","").replace(" ","")
        if "." in val and "," in val:
            val = val.replace(".", "").replace(",", ".")
        elif "," in val and "." not in val:
            val = val.replace(",", ".")
        elif "." in val and re.fullmatch(r"\-?\d{1,3}(?:\.\d{3})+", val):
            val = val.replace(".", "")
        try:
            f = float(val)
            if f <= 0 or f > MAX_KWH_PER_PERIOD:
                continue
            return str(int(round(f))) if f.is_integer() else f"{f:.2f}"
        except:
            continue
    return ""

def find_total_kwh_any(ocr: str) -> str:
    txt = ocr.replace("\xa0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," ")
    m = re.search(r"\bTotal\s+(\-?\s*\d{1,3}(?:[.\s]\d{3})+|\-?\s*\d+(?:[.,]\d+)?)\s*kWh\b", txt, flags=re.I)
    if not m:
        return ""
    val = m.group(1).replace(" ", "")
    if "." in val and "," not in val and re.fullmatch(r"\-?\d{1,3}(?:\.\d{3})+", val):
        val = val.replace(".", "")
    elif "," in val and "." not in val:
        val = val.replace(",", ".")
    return _safe_kwh(val)

def _fmt_kwh_variants(kwh_str: str):
    s = kwh_str.strip().replace(" ", "")
    try:
        if "," in s and "." not in s:
            base = float(s.replace(",", "."))
        elif "." in s and s.count(".") == 1 and len(s.split(".")[1]) <= 2:
            base = float(s)
        else:
            base = float(s.replace(".", ""))
    except:
        base = None

    variants = {s}
    pure = s.replace(".", "")
    variants.add(pure)

    if base is not None and base >= 1000 and float(int(base)) == base:
        digits = f"{int(base)}"
        miles = ""
        while digits:
            miles = (("." + digits[-3:]) if miles else digits[-3:]) + miles
            digits = digits[:-3]
        variants.add(miles) 

    if base is not None and not base.is_integer():
        ent = int(base)
        dec = f"{base:.2f}".split(".")[1]
        variants.update({f"{ent},{dec}", f"{ent}.{dec}"})
    return list(variants)

def find_importe_after_total_for_value(ocr: str, kwh_value: str, lookahead_chars: int = 240):
    txt = (ocr.replace("\xa0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," "))
    flat = re.sub(r"\s+", " ", txt)

    for v in _fmt_kwh_variants(kwh_value):
        pat = re.compile(rf"(?i)\bTotal\s+{re.escape(v)}\s*kwh\b")
        m = pat.search(flat)
        if not m:
            continue
        seg = flat[m.end(): m.end()+lookahead_chars]
        m_eur = re.search(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:€|Eur)\b", seg, flags=re.I)
        if m_eur:
            val = parse_number_keep_decimals(m_eur.group(1))
            ctx = snippet_around(flat, m.start(), m.end()+len(m_eur.group(0)))
            return val, ctx
        m_num = re.search(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\b", seg)
        if m_num:
            val = parse_number_keep_decimals(m_num.group(1))
            ctx = snippet_around(flat, m.start(), m.end()+len(m_num.group(0)))
            return val, ctx
    return "", ""

def find_euro_total_energia_line(ocr: str):
    txt = (ocr.replace("\xa0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," "))
    pat_total_kwh = re.compile(r"(?i)\bTotal\s+(-?\s*\d{1,3}(?:[.\s]\d{3})+|-?\s*\d+(?:[.,]\d+)?)\s*kwh")
    for m in pat_total_kwh.finditer(txt):
        tail = txt[m.end(): m.end() + 200]
        m_eur = re.search(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:€|Eur)\b", tail, flags=re.I)
        if m_eur:
            val = parse_number_keep_decimals(m_eur.group(1))
            ctx = snippet_around(txt, m.start(), m.end()+len(m_eur.group(0)))
            return val, ctx
        m_num = re.search(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))", tail)
        if m_num:
            val = parse_number_keep_decimals(m_num.group(1))
            ctx = snippet_around(txt, m.start(), m.end()+len(m_num.group(0)))
            return val, ctx
    return "", ""

def find_euro_total_kwh_nearby(ocr: str):
    txt = (ocr.replace("\xa0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," "))
    flat = re.sub(r"\s+", " ", txt)
    for m in re.finditer(r"(?i)\bTotal\s+\d[\d.\s,]*\s*kwh", flat):
        seg = flat[m.end(): m.end()+200]
        m_eur = re.search(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:€|Eur)\b", seg, flags=re.I)
        if m_eur:
            val = parse_number_keep_decimals(m_eur.group(1))
            ctx = snippet_around(flat, m.start(), m.end()+len(m_eur.group(0)))
            return val, ctx
    return "", ""

def sum_energia_consumida_iberdrola(ocr: str) -> str:
    txt = (ocr.replace("\xa0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," "))
    total = 0.0
    for line in txt.splitlines():
        low = line.lower()
        if ("energía consumida" in low or "energia consumida" in low) and re.search(r"\bp\d\b", low):
            if any(bad in low for bad in ("total", "exceso", "cargos", "acceso", "reactiva")):
                continue
            m = re.search(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:€|Eur)\b", line, flags=re.I)
            if m:
                try:
                    total += float(parse_number_keep_decimals(m.group(1)))
                except:
                    pass
    return f"{total:.2f}" if total > 0.01 else ""

def sum_euro_energia_activa_pn_strict_stateful(ocr: str, lookahead_lines: int = 6, lookbehind_lines: int = 3) -> str:
    txt = (ocr.replace("\xa0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," "))
    lines = [l for l in txt.splitlines() if l.strip()]

    anchor_pat = re.compile(r"energ[ií]a\s+activa(?!.*\b(cargos|acceso|reactiva)\b).*?\bP\s*([1-6])\b", re.I)
    forbid_pat = re.compile(r"\b(cargos?|acceso|reactiva|exceso|potencia|servicios?)\b", re.I)
    eur_pat    = re.compile(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:€|Eur)\b", re.I)
    unit_line  = re.compile(r"(?i)kwh\s+\d+(?:[.,]\d+)?\s+([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:€|Eur)\b")

    total = 0.0
    found = 0
    n = len(lines)

    for i in range(n):
        if not anchor_pat.search(lines[i].lower()):
            continue

        j0 = max(0, i - lookbehind_lines)
        j1 = min(n, i + 1 + lookahead_lines)
        for j in range(j0, j1):
            if j != i and forbid_pat.search(lines[j].lower()):
                break
            m = eur_pat.search(lines[j])
            hit = None
            if m:
                span = lines[j][max(0, m.start(1)-8): m.end(1)+8].lower()
                if "eur/kwh" not in span and "/kwh" not in span:
                    hit = m.group(1)
            if not hit:
                m2 = unit_line.search(lines[j])
                if m2:
                    hit = m2.group(1)
            if hit:
                val = parse_number_keep_decimals(hit)
                f = parse_number_es(val)
                if f is not None and f > 10:
                    total += f
                    found += 1
                    break

    return f"{total:.2f}" if found else ""

def sum_euro_energia_by_unitprice(ocr: str) -> str:
    """
    Suma importes con patrón 'kWh <tarifa> <importe> Eur/€' aunque haya saltos/espacios raros.
    • Permite CARGOS; excluye ACCESO/REACTIVA/regularizaciones/servicios…
    • Doble pasada: flat y multilínea (DOTALL).
    • Filtra €/kWh razonable y deduplica por (importe, tarifa).
    """
    # normaliza espacios
    txt = (ocr.replace("\xa0"," ")
              .replace("\u202f"," ")
              .replace("\u2009"," ")
              .replace("\u2007"," "))
    flat = re.sub(r"\s+", " ", txt).strip()

    # rango de tarifa válido
    SEL_MIN = float(os.environ.get("SEL_MIN_PRICE_PER_KWH", "0.035"))
    SEL_MAX = float(os.environ.get("SEL_MAX_PRICE_PER_KWH", "0.45"))

    # NO incluimos 'potencia' ni 'exceso' aquí
    FORBID = (
        "acceso","reactiva","servicio","servicios","alquiler","mantenimiento",
        "regularización","regularizacion","peaje","impuesto","alquiler contador",
        "financiación","financiacion"
    )
    # palabras que indican contexto de término de energía
    POS = ("energía", "energia", "término", "termino", "activa", "variable")

    pat_flat = re.compile(
        r"(?i)kwh\s+(\d+(?:[.,]\d+)?)\s+([\-−–]?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:eur|€)\b"
    )
    pat_multi = re.compile(
        r"(?is)kwh\W+(\d+(?:[.,]\d+)?)\W+([\-−–]?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:eur|€)\b"
    )

    hits = []

    def _ok_unit(x):
        v = parse_number_es(x)
        return v is not None and SEL_MIN <= v <= SEL_MAX

    def _add_from(src: str, m, where: str, ctx_pad: int = 80):
        unit_raw, amt_raw = m.group(1), m.group(2)
        if not _ok_unit(unit_raw):
            return
        unit = parse_number_es(unit_raw)
        amt  = parse_number_es(parse_number_keep_decimals(amt_raw))
        if amt is None:
            return
        a, b = max(0, m.start()-ctx_pad), min(len(src), m.end()+ctx_pad)
        ctx = src[a:b].lower()

        if not any(p in ctx for p in POS):
            if any(w in ctx for w in FORBID):
                return

        hits.append((round(amt, 2), round(unit, 6), where))

    for m in pat_flat.finditer(flat):
        _add_from(flat, m, "flat")

    for m in pat_multi.finditer(txt):
        _add_from(txt, m, "multi")

    seen = set()
    total = 0.0
    for amt, unit, where in hits:
        key = (f"{amt:.2f}", f"{unit:.6f}")
        if key in seen:
            continue
        seen.add(key)
        total += amt

    dprint("sum_by_unitprice hits:", hits, "total:", total)
    return f"{total:.2f}" if total > 0 else ""

def sum_euro_energia_activa_pn_strict(ocr: str) -> str:
    """
    Suma los importes (EUR) de líneas de ENERGÍA ACTIVA P1..P6,
    excluyendo CARGOS / ACCESO / REACTIVA. Captura tanto si el importe
    va antes como después de la etiqueta.
    """
    txt = (ocr.replace("\xa0"," ").replace("\u202f"," ")
             .replace("\u2009"," ").replace("\u2007"," "))
    lines = txt.splitlines()
    total = 0.0

    pat_label   = re.compile(r"energ[ií]a\s+activa\b", re.I)
    pat_bad     = re.compile(r"(cargos|acceso|reactiva)", re.I)
    pat_periodo = re.compile(r"\bp\s*[1-6]\b", re.I)
    pat_eur     = re.compile(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:€|eur)\b", re.I)

    for i, ln in enumerate(lines):
        low = ln.lower()
        if pat_bad.search(low):
            continue
        if pat_label.search(low) and pat_periodo.search(low):
            m = pat_eur.search(ln)
            if not m:
                window = " ".join(lines[max(0,i-1): min(len(lines), i+2)])
                m = pat_eur.search(window)
            if m:
                try:
                    total += float(parse_number_keep_decimals(m.group(1)))
                except:
                    pass

    return f"{total:.2f}" if total > 0.01 else ""

def sum_termino_energia(ocr: str) -> str:
    lines = ocr.splitlines()
    total = 0.0
    for i, line in enumerate(lines):
        low = line.lower()
        if "energía activa" in low and "cargos" not in low and "acceso" not in low:
            for offset in range(0, 6):
                if i + offset >= len(lines):
                    break
                next_line = lines[i + offset]
                amt = first_amount(next_line)
                if amt:
                    try:
                        val = float(amt)
                        if val > 50:
                            total += val
                            break
                    except:
                        continue
    return f"{total:.2f}" if abs(total) > 0.01 else ""

def sum_energia_generica_por_periodos(ocr: str) -> str:
    """
    Suma importes € en líneas de energía por periodos (P1..P6) evitando cargos/accesos/reactiva
    y evitando precios unitarios pegados a 'kWh'.
    """
    total = 0.0
    for line in ocr.splitlines():
        low = line.lower()
        if not any(w in low for w in ("energía", "energia")):
            continue
        if re.search(r"\bp\d\b", low) is None:
            continue
        if any(bad in low for bad in ("cargos", "acceso", "reactiva", "exceso", "potencia")):
            continue
        if "kwh" in low:
            m = re.search(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*€", line)
            if not m:
                continue
            span = line[max(0, m.start(1)-8): m.end(1)+8].lower()
            if "kwh" in span or "/kwh" in span:
                continue
            try:
                total += float(parse_number_keep_decimals(m.group(1)))
            except:
                pass
        else:
            m = re.search(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:€|eur)\b", line, flags=re.I)
            if m:
                try:
                    total += float(parse_number_keep_decimals(m.group(1)))
                except:
                    pass
    return f"{total:.2f}" if total > 0.01 else ""

def find_cups_in_ocr(ocr):
    compact = ocr.replace(" ", "")
    m = CUPS_RE.search(compact)
    if m: return m.group(0)
    m = CUPS_RE.search(ocr)
    return m.group(0).replace(" ", "") if m else ""

def find_total_kwh_naturgy_strict(ocr: str, lookahead_lines: int = 6) -> str:
    lines = (ocr.replace("\xa0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," ").splitlines())
    n = len(lines)

    def norm(s: str) -> str:
        return re.sub(r"\s+", " ", s.lower())

    for i in range(n):
        jmax = min(n, i + 1 + lookahead_lines)
        chunk = [ln for ln in lines[i:jmax] if not _is_equivalence_or_unit_line(ln)]
        if not chunk:
            continue
        window = " ".join(chunk)
        loww = norm(window)
        if "kwh" in loww and ("consumo" in loww or "total" in loww):
            m = re.search(r"(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*kwh\b", window, flags=re.I)
            if m:
                val = m.group(1).replace(" ", "")
                if "." in val and "," not in val and re.fullmatch(r"\d{1,3}(?:\.\d{3})+", val):
                    val = val.replace(".", "")
                elif "," in val and "." not in val:
                    val = val.replace(",", ".")
                return val

    candidates = []
    for m in re.finditer(r"(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*kwh\b", ocr, flags=re.I):
        span_start = max(0, m.start() - 80)
        span_text = ocr[span_start:m.end()]
        if _is_equivalence_or_unit_line(span_text):
            continue
        val = m.group(1).replace(" ", "")
        if "." in val and "," not in val and re.fullmatch(r"\d{1,3}(?:\.\d{3})+", val):
            val = val.replace(".", "")
        elif "," in val and "." not in val:
            val = val.replace(",", ".")
        try:
            f = float(val)
            if 1 <= f <= 500000:
                candidates.append((f, val))
        except:
            pass
    if candidates:
        return max(candidates, key=lambda x: x[0])[1]
    return ""

def find_total_kwh_total_flat(ocr: str, lookahead_chars: int = 200) -> str:
    txt = (ocr.replace("\xa0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," "))
    flat = re.sub(r"\s+", " ", txt)
    m = re.search(r"(?i)\bTotal\b.{0,%d}?(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*kWh\b" % lookahead_chars, flat)
    if not m:
        return ""
    val = m.group(1).replace(" ", "")
    if "." in val:
        dec = val.split(".", 1)[1]
        if len(dec) > 3:
            return ""   
    if "." in val and "," not in val and re.fullmatch(r"\d{1,3}(?:\.\d{3})+", val):
        val = val.replace(".", "")
    elif "," in val and "." not in val:
        val = val.replace(",", ".")
    return val

def find_exceso_potencia_kw(ocr: str, lookahead_lines: int = 6) -> str:
    """
    Busca importes de exceso de potencia junto a kW cerca de las etiquetas.
    Prioriza cantidades con 1-2 decimales y 'kW' pegado para evitar enteros sueltos.
    """
    lines = (ocr.replace("\xa0"," ").replace("\u202f"," ")
               .replace("\u2009"," ").replace("\u2007"," ").splitlines())
    labels = ("excesos de potencia", "exceso potencia", "exceso de potencia")
    n = len(lines)
    best_val = None

    pat_kw = re.compile(r"([\-−–]?\s*\d{1,3}(?:[.,]\d{1,2}))\s*kW\b", flags=re.I)

    for i, line in enumerate(lines):
        low = line.lower()
        if any(lbl in low for lbl in labels):
            jmax = min(n, i + 1 + lookahead_lines)
            window = " ".join(lines[i:jmax])

            for m in pat_kw.finditer(window):
                val = parse_number_keep_decimals(m.group(1))
                try:
                    f = float(val)
                    if f > 0.1:
                        if best_val is None:
                            best_val = val
                        else:
                            if "." in val and "." not in best_val:
                                best_val = val
                except:
                    pass

            if best_val:
                return best_val

            nums = re.findall(r"([\-−–]?\s*\d{1,3}(?:[.,]\d{1,2}))\b", window)
            best_f = -1.0
            best_tmp = None
            for cand in nums:
                val = parse_number_keep_decimals(cand)
                try:
                    f = float(val)
                    if f > best_f and f > 0.1:
                        best_f = f
                        best_tmp = val
                except:
                    pass
            if best_tmp:
                return best_tmp

    return ""

def find_euro_energia_naturgy(ocr: str, lookahead_lines: int = 6) -> str:
    """
    Naturgy: bloques de EUR sin símbolo €.
    Tomamos el MAYOR importe en ventanas que mencionan energía/variable, evitando
    palabras de cargos/servicios/regularizaciones.
    """
    lines = (ocr.replace("\xa0"," ").replace("\u202f"," ")
              .replace("\u2009"," ").replace("\u2007"," ").splitlines())
    n = len(lines)
    OK = ("término energía", "termino energia", "energía activa", "energia activa",
          "término variable", "termino variable", "variable", "energía", "energia")
    FORBID = ("cargo","cargos","peaje","acceso","impuesto","alquiler","equipos",
              "potencia","servicios","servicio","otros","fijo","cuota","gestión",
              "gestion","regularización","regularizacion","mantenimiento","comercialización",
              "comercializacion","alquiler contador","financiación","financiacion")

    def ok_line(s: str) -> bool:
        low = s.lower()
        return any(k in low for k in OK) and not any(b in low for b in FORBID)

    best = None
    num_pat = re.compile(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\b")

    for i in range(n):
        if ok_line(lines[i]):
            jmax = min(n, i + 1 + lookahead_lines)
            window = " ".join(lines[i:jmax])

            for m in re.finditer(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*EUR\b", window, flags=re.I):
                val = parse_number_keep_decimals(m.group(1))
                try:
                    f = float(val)
                    if f > 10 and (best is None or f > best[0]):
                        best = (f, val)
                except:
                    pass

            for m in num_pat.finditer(window):
                span = window[max(0, m.start()-6): m.end()+6].lower()
                if "kwh" in span or "/kwh" in span:
                    continue
                val = parse_number_keep_decimals(m.group(1))
                try:
                    f = float(val)
                    if f > 10 and (best is None or f > best[0]):
                        best = (f, val)
                except:
                    pass

    return best[1] if best else ""

def _float_ok_kwh(s: str):
    """Convierte a float y valida rango razonable de kWh."""
    if not s:
        return None
    t = s.replace("\u00A0", "").replace(" ", "")
    if "." in t and "," in t:
        t = t.replace(".", "").replace(",", ".")
    else:
        t = t.replace(",", ".")
    try:
        f = float(t)
    except:
        return None
    if f <= 0 or f > MAX_KWH_PER_PERIOD:
        return None
    return f

def _too_many_decimals_for_kwh(s: str) -> bool:
    """True si parece precio unitario: más de 3 decimales."""
    if not s:
        return False
    t = s.replace("\u00A0", "").replace(" ", "")
    if "." in t and "," in t:
        t = t.replace(".", "").replace(",", ".")
    else:
        t = t.replace(",", ".")
    if t.count(".") == 1:
        dec = t.split(".")[1]
        return len(dec) > 3
    return False

def kwh_candidates_around_kwh_token(ocr: str, look_width_chars: int = 80) -> list[float]:
    txt = ocr.replace("\xa0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," ")
    flat = re.sub(r"\s+", " ", txt)
    tok = re.compile(r"k\W*w\W*h", re.I)
    nums = []
    for m in tok.finditer(flat):
        a, b = max(0, m.start()-look_width_chars), min(len(flat), m.end()+look_width_chars)
        window = flat[a:b]
        loww = window.lower()
        if not any(k in loww for k in ("energía", "energia", "término energía", "termino energia", "consumo", "total")):
            continue
        for mn in re.finditer(r"(-?\s*\d{1,3}(?:[.\s]\d{3})+|-?\s*\d+(?:[.,]\d+)?)", window):
            raw = mn.group(0)
            span = window[max(0, mn.start()-6): mn.end()+6].lower()
            if "€/kwh" in span or "/kwh" in span:
                continue
            if _too_many_decimals_for_kwh(raw):
                continue
            f = _float_ok_kwh(raw)
            if f is None or f < 10:
                continue
            nums.append(f)
    return nums

def has_payable_energy(ocr: str, lookahead_lines: int = 5) -> bool:
    """
    True si hay algún bloque de ENERGÍA (activa/variable/término energía)
    con un IMPORTE € cercano (no €/kWh unitario).
    Excluye reactiva/acceso/potencia/exceso/servicios.
    """
    txt = (ocr.replace("\xa0"," ").replace("\u202f"," ")
             .replace("\u2009"," ").replace("\u2007"," "))
    lines = [l for l in txt.splitlines() if l.strip()]
    n = len(lines)

    OK = ("energía activa", "energia activa", "término energía", "termino energia",
          "término variable", "termino variable", "energia", "energía")
    FORBID = ("reactiva","acceso","potencia","exceso","servicio","servicios",
              "regularización","regularizacion","alquiler","peaje","impuesto")

    eur_pat = re.compile(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:€|eur)\b", re.I)

    def _kwh_near(line: str, a: int, b: int, pad: int = 8) -> bool:
        seg = line[max(0,a-pad):min(len(line), b+pad)].lower()
        return "kwh" in seg and "/kwh" in seg  # precio unitario, no importe

    for i, ln in enumerate(lines):
        low = ln.lower()
        if any(ok in low for ok in OK) and not any(b in low for b in FORBID):
            jmax = min(n, i + 1 + lookahead_lines)
            for j in range(i, jmax):
                m = eur_pat.search(lines[j])
                if m:
                    # filtra precios unitarios tipo "€/kWh"
                    span = lines[j][max(0, m.start(1)-8): m.end(1)+8].lower()
                    if "/kwh" in span or "eur/kwh" in span:
                        continue
                    return True

    # También acepta líneas compactas tipo "kWh <unit> <importe> Eur"
    pat_compacto = re.compile(r"(?i)kwh\W+\d+(?:[.,]\d+)?\W+([\-−–]?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:€|eur)\b")
    if pat_compacto.search(txt):
        return True

    return False


def find_consumo_from_periods_sum(ocr: str) -> str:
    """
    Suma los kWh de líneas con P1..P6 donde aparece 'kWh' (evita reactiva/cargos/potencia).
    """
    total = 0.0
    lines = (ocr.replace("\xa0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," ").splitlines())
    num_pat = re.compile(r"(-?\s*\d{1,3}(?:[.\s]\d{3})+|-?\s*\d+(?:[.,]\d+)?)")

    for line in lines:
        low = line.lower()
        if re.search(r"\bp\d\b", low) is None:
            continue
        if "kwh" not in low:
            continue
        if any(b in low for b in ("reactiva","kvarh","kvar","cargos","acceso","potencia","exceso")):
            continue

        best = 0.0
        for mn in num_pat.finditer(line):
            c = mn.group(0)
            if _too_many_decimals_for_kwh(c):
                continue
            f = _float_ok_kwh(c)
            if f is None:
                continue
            span = line[max(0, mn.start()-6): mn.end()+6].lower()     
            if "/kwh" in span or "€/kwh" in span:
                continue
            if f > best:
                best = f
        total += best

    if total > 0.5:
        r = round(total)
        return f"{int(r)}" if abs(r - total) < 1e-9 else f"{total:.2f}"
    return ""

def find_consumo_max_kwh_in_doc(ocr: str) -> str:
    txt = (ocr.replace("\xa0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," "))
    best = None
    for m in re.finditer(r"(-?\s*\d{1,3}(?:[.\s]\d{3})+|-?\s*\d+(?:[.,]\d+)?)\s*k\W*w\W*h\b", txt, flags=re.I):
        a, b = max(0, m.start()-100), min(len(txt), m.end()+100)
        ctx = txt[a:b].lower()
        if any(bad in ctx for bad in ("reactiva","kvarh","kvar","potencia","exceso","m³"," m3","kwh/m","/m3","m^3")):
            continue
        if not any(good in ctx for good in ("energía","energia","consumo","total","factura","término energía","termino energia")):
            continue
        val = m.group(1)
        if _too_many_decimals_for_kwh(val):
            continue
        f = _float_ok_kwh(val)
        if f is None or f < 10:
            continue
        if (best is None) or (f > best[0]):
            best = (f, str(int(f)) if float(int(f)) == f else f"{f:.2f}")
    return best[1] if best else ""


def find_euro_energia_inline_kwh(ocr: str, window_after=180) -> str:
    """
    Naturgy (línea compacta o con salto): 'kWh <precio_unit> <importe> Eur ...'
    Sin patrones globales costosos: anclamos en 'kwh <n.nn>' y exploramos una
    ventana breve a la derecha para capturar importe.
    """
    txt = (ocr.replace("\xa0"," ").replace("\u202f"," ")
              .replace("\u2009"," ").replace("\u2007"," "))
    flat = re.sub(r"\s+", " ", txt)

    unit_pat = re.compile(r"(?i)kwh\s+\d+(?:[.,]\d+)")
    euro_pat  = re.compile(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:eur|€)\b", re.I)
    euro_pat2 = re.compile(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\b")

    for m in unit_pat.finditer(flat):
        seg = flat[m.end(): m.end()+window_after]

        m1 = euro_pat.search(seg)
        if m1:
            return parse_number_keep_decimals(m1.group(1))

        m2 = euro_pat2.search(seg)
        if m2:
            cand = parse_number_keep_decimals(m2.group(1))
            f = parse_number_es(cand)
            if f is not None and f >= float(os.environ.get("MIN_EUR_CONSUMO","10")):
                return cand

    return ""

def find_total_kwh_multiline_relaxed(ocr: str, lookahead_lines: int = 6) -> str:
    lines = (ocr.replace("\xa0"," ")
                .replace("\u202f"," ")
                .replace("\u2009"," ")
                .replace("\u2007"," ")
                .splitlines())
    n = len(lines)

    def _norm_num(val: str) -> str:
        val = val.replace(" ", "")
        if "." in val and "," not in val and re.fullmatch(r"\d{1,3}(?:\.\d{3})+", val):
            return val.replace(".", "")
        if "," in val and "." not in val:
            return val.replace(",", ".")
        return val

    for i, ln in enumerate(lines):
        if re.search(r"(?i)\btotal\b", ln):
            jmax = min(n, i + 1 + lookahead_lines)
            for j in range(i, jmax):
                m = re.search(r"(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*kwh\b", lines[j], flags=re.I)
                if m:
                    return _norm_num(m.group(1))
    return ""

def _is_probably_unit_price(num_str: str) -> bool:
    """
    Heurística: si el número tiene >3 decimales, probablemente es un precio unitario (€/kWh).
    """
    s = num_str.strip().replace(" ", "")
    s = s.replace(".", "") if ("," in s and "." in s) else s
    s = s.replace(",", ".")
    parts = s.split(".")
    if len(parts) == 2 and len(parts[1]) > 3:
        return True
    return False

def find_amount_after_labels(ocr, labels):
    """
    Busca un importe relacionado con ciertas etiquetas.
    - Ventana de 6 líneas (línea + 5 siguientes).
    - Prioriza importes con símbolo (EUR/€).
    - Si no hay símbolo, elige el MAYOR número de la ventana.
    - Evita números pegados a 'kWh' (suelen ser precios unitarios).
    """
    lines = ocr.splitlines()

    def _has_kwh_near(line: str, start: int, end: int, pad: int = 8) -> bool:
        a = max(0, start - pad)
        b = min(len(line), end + pad)
        return "kwh" in line[a:b].lower() or "/kwh" in line[a:b].lower()

    best_sym = None
    best_sym_f = float("-inf")

    for idx, line in enumerate(lines):
        low = line.lower()
        if any(lbl in low for lbl in labels):
            jmax = min(len(lines), idx + 6)

            # 1) Con moneda: mayor valor (filtrando kWh cercanos)
            for k in range(idx, jmax):
                current_line = lines[k]
                for m in re.finditer(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d+))\s*(?:eur|€)\b", current_line, flags=re.I):
                    if _has_kwh_near(current_line, m.start(1), m.end(1)):
                        continue
                    num = parse_number_keep_decimals(m.group(1))
                    try:
                        f = float(num)
                        if f > best_sym_f:
                            best_sym, best_sym_f = num, f
                    except:
                        pass
            if best_sym is not None:
                return best_sym

            # 2) Sin moneda: mayor número (filtrando kWh cercanos)
            best = None
            best_f = float("-inf")
            for k in range(idx, jmax):
                current_line = lines[k]
                for m in re.finditer(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d+)|\-?\s*\d+(?:[.,]\d+)?)", current_line):
                    if _has_kwh_near(current_line, m.start(1), m.end(1)):
                        continue
                    num = parse_number_keep_decimals(m.group(1))
                    try:
                        f = float(num)
                        if f > best_f:
                            best, best_f = num, f
                    except:
                        pass
            if best is not None:
                return best
    return ""


def norm_text(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))

def find_total_factura_strict(ocr: str) -> str:
    flat = norm_text(ocr)
    flat_compact = re.sub(r"\s+", " ", flat)
    lower = flat_compact.lower()
    m = re.search(r"\btotal\s*factura\b", lower)
    if not m:
        return ""
    start = m.end()
    window = flat_compact[start:start+200]
    m_eur = re.search(
        r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d+)?|\-?\s*\d+(?:[.,]\d+)?)(?:\s*(?:eur|€))",
        window, flags=re.I
    )
    if m_eur:
        return parse_number_keep_decimals(m_eur.group(0))
    m_num = re.search(
        r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d+)?|\-?\s*\d+(?:[.,]\d+)?)",
        window
    )
    if m_num:
        return parse_number_keep_decimals(m_num.group(0))
    return ""

def extract_period_dates(ocr: str):
    m = re.search(r"PERIODO\s+(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s*[-–]\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})", ocr, flags=re.I)
    if not m:
        return "", ""
    d1, d2 = m.group(1), m.group(2)
    return norm_date(d1), norm_date(d2)

def sum_euro_consumo_por_periodo(ocr: str) -> str:
    total = 0.0
    lineas_utiles = []
    for line in ocr.splitlines():
        lower = line.lower()
        if "término energía" in lower or "termino energia" in lower or "energía activa" in lower:
            if "cargos" in lower or "acceso" in lower:
                continue
            lineas_utiles.append(line)
    for linea in lineas_utiles:
        num = parse_number_keep_decimals(linea)
        if num:
            try:
                total += float(num)
            except:
                continue
    return f"{total:.2f}" if total > 0.01 else ""

MAX_KWH_PER_PERIOD = float(os.environ.get("MAX_KWH_PER_PERIOD", "700000"))

def _safe_kwh_signed(val_str: str, allow_negative: bool = False) -> str:
    if not val_str:
        return ""
    s = val_str.strip().replace("\u00A0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," ")
    s = s.replace(" ", "")
    neg = s.startswith("-") or s.startswith("−") or s.startswith("–")
    s = s.lstrip("-−–")

    if "." in s and "," not in s and re.fullmatch(r"\d{1,3}(?:\.\d{3})+", s):
        s = s.replace(".", "")
    elif "." in s and "," in s:
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")

    try:
        f = float(s)
    except:
        return ""
    if neg:
        f = -f
    if allow_negative:
        if not (-MAX_KWH_PER_PERIOD <= f <= -1 or 1 <= abs(f) <= MAX_KWH_PER_PERIOD):
            return ""
    else:
        if not (1 <= f <= MAX_KWH_PER_PERIOD):
            return ""
    return str(int(round(f))) if f.is_integer() else f"{f:.2f}"

def find_negative_kwh_in_doc(ocr: str) -> str:
    txt = ocr.replace("\xa0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," ")
    for m in re.finditer(r"(-\s*\d{1,3}(?:[.\s]\d{3})+|-\s*\d+(?:[.,]\d+)?)\s*k\W*w\W*h\b", txt, flags=re.I):
        raw = m.group(1)
        # evita reactiva/potencia/exceso
        ctx = txt[max(0, m.start()-80): m.end()+40].lower()
        if any(b in ctx for b in ("reactiva","kvarh","kvar","potencia","exceso")):
            continue
        val = _safe_kwh_signed(raw, allow_negative=True)
        if val.startswith("-"):
            return val
    return ""

def _safe_kwh(val_str: str) -> str:
    """
    Normaliza y valida un número de kWh. Acepta 1..MAX_KWH_PER_PERIOD.
    Soporta miles con puntos/espacios y coma decimal.
    """
    if not val_str:
        return ""
    s = val_str.strip().replace("\u00A0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," ")
    s = s.replace(" ", "")
    if "." in s and "," not in s and re.fullmatch(r"\-?\d{1,3}(?:\.\d{3})+", s):
        s = s.replace(".", "")
    elif "." in s and "," in s:
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    try:
        f = float(s)
    except:
        return ""
    if not (1 <= f <= MAX_KWH_PER_PERIOD):
        return ""
    return str(int(round(f))) if f.is_integer() else f"{f:.2f}"


# =========================
# Coerción / Ensamblado final
# =========================
def coerce_and_fill(out, ocr_text):
    def has_payable_energy(ocr: str, lookahead_lines: int = 5) -> bool:
        txt = (ocr.replace("\xa0"," ").replace("\u202f"," ").replace("\u2009"," ").replace("\u2007"," "))
        lines = [l for l in txt.splitlines() if l.strip()]
        n = len(lines)
        OK = ("energía activa", "energia activa", "término energía", "termino energia", "término variable", "termino variable", "energia", "energía")
        FORBID = ("reactiva","acceso","potencia","exceso","servicio","servicios","regularización","regularizacion","alquiler","peaje","impuesto")
        eur_pat = re.compile(r"([\-−–]?\s*\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:€|eur)\b", re.I)
        for i, ln in enumerate(lines):
            low = ln.lower()
            if any(ok in low for ok in OK) and not any(b in low for b in FORBID):
                jmax = min(n, i + 1 + lookahead_lines)
                for j in range(i, jmax):
                    m = eur_pat.search(lines[j])
                    if m:
                        span = lines[j][max(0, m.start(1)-8): m.end(1)+8].lower()
                        if "/kwh" in span or "eur/kwh" in span:
                            continue
                        return True
        pat_compacto = re.compile(r"(?i)kwh\W+\d+(?:[.,]\d+)?\W+([\-−–]?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}))\s*(?:€|eur)\b")
        if pat_compacto.search(txt):
            return True
        return False

    ocr0 = (
        ocr_text.replace("\xa0", " ")
                .replace("\u202f", " ")
                .replace("\u2009", " ")
                .replace("\u2007", " ")
    )

    out["fechaDesde"] = norm_date(out.get("fechaDesde",""))
    out["fechaHasta"] = norm_date(out.get("fechaHasta",""))

    cups = (out.get("cups","") or "").replace(" ", "").upper()
    if not CUPS_RE.fullmatch(cups):
        cups_fallback = find_cups_in_ocr(ocr0) or ""
        out["cups"] = cups_fallback or cups
    else:
        out["cups"] = cups

    consumo_locked = False
    tab_total = _safe_kwh(find_total_kwh_from_table(ocr0))
    if tab_total:
        out["consumo"] = tab_total
        consumo_locked = True

    if not consumo_locked:
        v = out.get("consumo","")
        if re.match(r"\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$", v or ""):
            v = ""
        cand_inicial = _safe_kwh_signed(parse_number_keep_decimals(v) if v else "")

        def _push(tag, s, allow_neg=False, bonus=0.0):
            if not s:
                return
            norm = _safe_kwh_signed(s, allow_negative=allow_neg)
            if not norm:
                return
            try:
                f = float(norm.replace(",", "."))
            except:
                return
            if abs(f) < 10:
                return
            score = abs(f) + bonus
            candidates.append((score, f, norm, tag))

        candidates = []
        _push("t5", cand_inicial, allow_neg=True, bonus=0.5)
        _push("naturgy_strict", find_total_kwh_naturgy_strict(ocr0))
        _push("total_kwh_any",  find_total_kwh_any(ocr0))
        _push("total_kwh_multiline", find_total_kwh_multiline_relaxed(ocr0, 6))
        try: _push("sum_periods", find_consumo_from_periods_sum(ocr0))
        except Exception: pass
        _push("num_before_kwh", find_consumo_kwh(ocr0))
        _push("max_kwh_doc",   find_consumo_max_kwh_in_doc(ocr0))
        try:
            cands = kwh_candidates_around_kwh_token(ocr0, look_width_chars=80)
            if cands:
                _push("kwh_token", str(max(cands)))
        except Exception:
            pass
        neg_kwh = find_negative_kwh_in_doc(ocr0)
        if neg_kwh:
            _push("neg_kwh_explicit", neg_kwh, allow_neg=True, bonus=5.0)

        total_f = parse_number_es(out.get("total",""))
        euro_f  = parse_number_es(out.get("euroConsumo",""))
        SEL_MIN = float(os.environ.get("SEL_MIN_PRICE_PER_KWH", "0.035"))
        SEL_MAX = float(os.environ.get("SEL_MAX_PRICE_PER_KWH", "0.45"))

        def _p_for(kwh_str):
            if euro_f is None: return None
            k = parse_number_es(kwh_str)
            if not k: return None
            return euro_f / k

        cand_kwh = []
        def _add(tag, s):
            v2 = _safe_kwh(s)
            if not v2: return
            f2 = parse_number_es(v2)
            if f2 is None or (1900 <= f2 <= 2100): return
            cand_kwh.append({"tag":tag, "s":v2, "f":f2, "p":_p_for(v2)})

        _add("naturgy_strict",   find_total_kwh_naturgy_strict(ocr0))
        _add("total_kwh_any",    find_total_kwh_any(ocr0))
        _add("total_kwh_relax",  find_total_kwh_multiline_relaxed(ocr0, 6))
        try: _add("sum_periods", find_consumo_from_periods_sum(ocr0))
        except Exception: pass
        _add("num_before_kwh",   find_consumo_kwh(ocr0))
        _add("max_kwh_doc",      find_consumo_max_kwh_in_doc(ocr0))

        consumo = ""
        if cand_kwh:
            if euro_f is not None:
                pref  = [c for c in cand_kwh if c["p"] is not None and SEL_MIN <= c["p"] <= SEL_MAX]
                okwide= [c for c in cand_kwh if c["p"] is not None and MIN_PRICE_PER_KWH <= c["p"] <= MAX_PRICE_PER_KWH]
                pool = pref if pref else (okwide if okwide else cand_kwh)
                best = min(pool, key=lambda c: (0 if c["p"] is None else abs(c["p"]-0.12), -c["f"]))
                consumo = best["s"]
            else:
                consumo = max(cand_kwh, key=lambda c: c["f"])["s"]

        if consumo:
            out["consumo"] = consumo

    tf = find_total_factura_strict(ocr0)
    if tf:
        out["total"] = tf
    else:
        label_total = find_amount_after_labels(
            ocr0,
            ["total a pagar", "importe total", "total a abonar", "totalfactura"]
        )
        if label_total:
            out["total"] = parse_number_keep_decimals(label_total)

    total_float = parse_number_es(out.get("total", ""))

    consumo_str = out.get("consumo","")
    euro_final = ""
    euro_candidates = []

    by_unit = sum_euro_energia_by_unitprice(ocr0)
    if _valid_eur(by_unit, total_float, ocr0) and _price_ok(consumo_str, by_unit):
        euro_candidates.insert(0, ("sum_by_unitprice", by_unit))

    s_fuzzy = sum_euro_energia_activa_pn_strict(ocr0)
    if _valid_eur(s_fuzzy, total_float, ocr0) and _price_ok(consumo_str, s_fuzzy):
        euro_candidates.append(("sum_energia_activa_pn", s_fuzzy))

    val_line, _ = find_euro_total_energia_line(ocr0)
    if _valid_eur(val_line, total_float, ocr0) and _price_ok(consumo_str, val_line):
        euro_candidates.append(("total_kwh_line", val_line))

    val_near, _ = find_euro_total_kwh_nearby(ocr0)
    if _valid_eur(val_near, total_float, ocr0) and _price_ok(consumo_str, val_near):
        euro_candidates.append(("total_kwh_nearby", val_near))

    if consumo_str:
        val_anchor, _ = find_importe_after_total_for_value(ocr0, consumo_str)
        if _valid_eur(val_anchor, total_float, ocr0) and _price_ok(consumo_str, val_anchor):
            euro_candidates.append(("anchored_total_kwh_value", val_anchor))

    for tag, val in [
        ("sum_energia_consumida_pn",        sum_energia_consumida_iberdrola(ocr0)),
        ("sum_energia_generica_periodos",   sum_energia_generica_por_periodos(ocr0)),
        ("naturgy_block_eur",               find_euro_energia_naturgy(ocr0)),
        ("naturgy_inline",                  find_euro_energia_inline_kwh(ocr0)),
        ("label_based",                     find_amount_after_labels(
                                               ocr0,
                                               ["término energía", "termino energia",
                                                "importe energía", "energia activa",
                                                "consumo energía"]))
    ]:
        if _valid_eur(val, total_float, ocr0) and _price_ok(consumo_str, val):
            euro_candidates.append((tag, val))

    if ("rectifica" in ocr0.lower() or "abono" in ocr0.lower()):
        neg = find_negative_euro_energia(ocr0)
        if _valid_eur(neg, total_float, ocr0):
            euro_candidates.insert(0, ("negative_energy", neg))

    if not euro_candidates and (total_float is not None and total_float < 0):
        for raw in [by_unit, s_fuzzy, val_line, val_near, (val_anchor if consumo_str else "")] + [
            sum_energia_consumida_iberdrola(ocr0),
            sum_energia_generica_por_periodos(ocr0),
            find_euro_energia_naturgy(ocr0),
            find_euro_energia_inline_kwh(ocr0),
        ]:
            if not raw:
                continue
            if _price_ok(consumo_str, raw):
                euro_candidates.append(("neg_fallback", "-" + parse_number_keep_decimals(raw)))
                break

    if euro_candidates:
        euro_final = euro_candidates[0][1]
    out["euroConsumo"] = euro_final

    exceso = find_amount_after_labels(
        ocr0,
        ["excesos de potencia", "exceso potencia", "exceso de potencia"]
    )
    if exceso and re.search(r"[.,]\d{1,2}\b", exceso):
        out["excesoPotencia"] = parse_number_keep_decimals(exceso)
    else:
        exceso_kw = find_exceso_potencia_kw(ocr0)
        out["excesoPotencia"] = parse_number_keep_decimals(exceso_kw) if exceso_kw else ""

    if out["excesoPotencia"]:
        out["excesoPotencia"] = parse_number_keep_decimals(out["excesoPotencia"])

    d1, d2 = extract_period_dates(ocr0)
    if d1: out["fechaDesde"] = d1
    if d2: out["fechaHasta"] = d2

    ef = parse_number_es(out.get("euroConsumo",""))
    if ef is not None and ef < 0:
        if out.get("consumo") and not str(out["consumo"]).strip().startswith("-"):
            out["consumo"] = "-" + str(out["consumo"]).lstrip("+")
    elif (total_float is not None and total_float < 0) and out.get("consumo") and not out.get("euroConsumo"):
        low = ocr0.lower()
        if "abono" in low or "rectifica" in low:
            out["consumo"] = "-" + str(out["consumo"]).lstrip("+")

    if not out.get("euroConsumo"):
        if not has_payable_energy(ocr0):
            out["consumo"] = ""

    return out


# =========================
# Prompt & T5
# =========================
def build_prompt(ocr_text: str, max_chars=8000) -> str:
    instrucciones = (
        "Extrae estos campos de una factura eléctrica y responde SOLO en el formato "
        "'clave:valor; ...' usando EXACTAMENTE estas claves: "
        f"{', '.join(CAMPOS)}. No inventes valores."
    )
    texto = ocr_text[:max_chars]
    return f"{instrucciones}\n\nTEXTO_OCR:\n{texto}"

def infer_from_text(ocr_text, max_input=1536, max_new_tokens=128):
    if not ocr_text or not isinstance(ocr_text, str):
        return _empty_out()
    try:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        tokenizer = T5Tokenizer.from_pretrained(MODEL_DIR)
        model = T5ForConditionalGeneration.from_pretrained(MODEL_DIR).to(device)
        prompt = build_prompt(ocr_text)
        inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=max_input).to(device)
        gen = model.generate(**inputs, max_new_tokens=max_new_tokens, num_beams=4,
                             length_penalty=0.8, early_stopping=True)
        decoded = tokenizer.decode(gen[0], skip_special_tokens=True)
        out = parse_target(decoded)
        if not isinstance(out, dict):
            out = _empty_out()
        out = coerce_and_fill(out, ocr_text)
        if not isinstance(out, dict):
            out = _empty_out()
        for k in CAMPOS:
            out.setdefault(k, "")
        return out
    except Exception as e:
        dprint("infer_from_text fallback por excepción:", repr(e))
        safe = _empty_out()
        try:
            safe["cups"] = find_cups_in_ocr(ocr_text) or ""
            c_any = find_total_kwh_any(ocr_text)
            if c_any: safe["consumo"] = c_any
            tf = find_total_factura_strict(ocr_text)
            if tf: safe["total"] = tf
        except Exception:
            pass
        return safe

def evaluar_accuracy(predicho, esperado):
    campos = CAMPOS
    aciertos = {}
    total = len(campos)
    correctos = 0
    for campo in campos:
        v_pred = (predicho.get(campo) or "").strip()
        v_real = (esperado.get(campo) or "").strip()
        if campo in ("fechaDesde", "fechaHasta"):
            es_igual = same_date(v_pred, v_real)
        elif campo in ("consumo", "euroConsumo", "total", "excesoPotencia"):
            es_igual = same_number(v_pred, v_real)
            if not es_igual:
                es_igual = (v_pred == v_real)
        else:
            es_igual = (v_pred == v_real)
        aciertos[campo] = {"predicho": v_pred, "esperado": v_real, "ok": es_igual}
        if es_igual:
            correctos += 1
    acc_global = correctos / total
    return aciertos, acc_global

def cargar_esperados_de_json(carpeta_o_pdf):
    ruta = carpeta_o_pdf
    if os.path.isfile(ruta):
        ruta = os.path.dirname(os.path.abspath(ruta))
    expected_path = os.path.join(ruta, "expected.json")
    if os.path.exists(expected_path):
        try:
            with open(expected_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[WARN] No se pudo leer expected.json: {e}")
    return {}

def esperado_por_nombre(nombre_pdf):
    base = nombre_pdf.lower()
    mapping = {
    }
    return mapping.get(base, None)

def _fmt_secs(s):
    if s < 1:
        return f"{s*1000:.0f} ms"
    m, sec = divmod(int(s), 60)
    h, m = divmod(m, 60)
    if h: return f"{h} h {m} min {sec} s"
    if m: return f"{m} min {sec} s"
    return f"{sec} s"

def evaluar_y_mostrar(resultado, esperado, titulo=""):
    aciertos, acc = evaluar_accuracy(resultado, esperado)
    print("\n== EVALUACIÓN ==" + (f" [{titulo}]" if titulo else ""))
    all_ok = True
    for campo, detalle in aciertos.items():
        estado = "✅" if detalle["ok"] else "❌"
        print(f"{estado} {campo}: predicho='{detalle['predicho']}' / esperado='{detalle['esperado']}'")
        if not detalle["ok"]:
            all_ok = False
    if all_ok:
        print("📊 Factura COMPLETAMENTE correcta ✅")
    else:
        print("📊 Factura con ERRORES ❌")
    return all_ok

# =========================
# Modo comprobación OCR
# =========================
def ocr_quality_report(pdf_path, lookahead_lines=4):
    report = {
        "source": "",
        "pages": 0,
        "char_count": 0,
        "non_ascii_ratio": 0.0,
        "digit_ratio": 0.0,
        "avg_confidence": None,
        "per_page_confidence": [],
        "keyword_coverage": {},
        "kwh_candidates": [],
        "suspicious_lines": [],
        "sample_head": "",
        "sample_tail": ""
    }
    doc = fitz.open(pdf_path)
    report["pages"] = len(doc)
    embedded = []
    for page in doc:
        embedded.append(page.get_text("text"))
    embedded_text = "\n".join(s.strip() for s in embedded if s and s.strip())
    embedded_text = "\n".join(l.strip() for l in embedded_text.splitlines() if l.strip())

    text = ""
    confidences_by_page = []
    if len(embedded_text) >= 50:
        report["source"] = "embedded"
        text = embedded_text
    else:
        report["source"] = "ocr"
        zoom = 3.2
        mat = fitz.Matrix(zoom, zoom)
        tmpdir = tempfile.TemporaryDirectory()
        png_paths = []
        doc = fitz.open(pdf_path)
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=mat, alpha=False)
            if pix.width < 32 or pix.height < 32:
                continue
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            img = ImageOps.grayscale(img)
            img = ImageOps.autocontrast(img)
            img = img.filter(ImageFilter.SHARPEN)
            out_path = os.path.join(tmpdir.name, f"page_{i+1:03d}.png")
            img.save(out_path, format="PNG")
            png_paths.append(out_path)
        if png_paths:
            docfile = DocumentFile.from_images(png_paths)
            ocr = ocr_predictor(pretrained=True, assume_straight_pages=True)
            result = ocr(docfile)
            lines = []
            for page in result.pages:
                page_conf = []
                for block in page.blocks:
                    for line in block.lines:
                        line_text = " ".join(w.value for w in line.words)
                        lines.append(line_text)
                        for w in line.words:
                            c = getattr(w, "confidence", None)
                            if c is not None:
                                page_conf.append(float(c))
                if page_conf:
                    confidences_by_page.append(sum(page_conf)/len(page_conf))
            text = "\n".join(lines).replace("\xa0"," ").replace("\t"," ").strip()
            text = "\n".join(l.strip() for l in text.splitlines() if l.strip())

    report["char_count"] = len(text)
    if report["char_count"] > 0:
        non_ascii = sum(1 for ch in text if ord(ch) > 126)
        digits = sum(1 for ch in text if ch.isdigit())
        report["non_ascii_ratio"] = non_ascii / report["char_count"]
        report["digit_ratio"] = digits / report["char_count"]

    if confidences_by_page:
        report["per_page_confidence"] = confidences_by_page
        report["avg_confidence"] = sum(confidences_by_page) / len(confidences_by_page)

    low = text.lower()
    keywords = [
        "kwh", "consumo", "total factura", "término energía", "termino energia",
        "energía activa", "energia activa", "importe", "€", "eur", "periodo", "cups"
    ]
    report["keyword_coverage"] = {k: (k in low) for k in keywords}

    suspicious = []
    for line in text.splitlines():
        if not line.strip():
            continue
        rares = sum(1 for ch in line if ord(ch) > 126 and ch not in "€ºª·—–-“”¡¿")
        if len(line) >= 10 and rares / len(line) > 0.1:
            suspicious.append(line[:160])
    report["suspicious_lines"] = suspicious[:20]

    lines = text.splitlines()
    def _norm_num(s):
        s = s.replace(" ", "")
        if "." in s and "," in s: s = s.replace(".", "").replace(",", ".")
        elif "," in s and "." not in s: s = s.replace(",", ".")
        return s

    for i, line in enumerate(lines):
        low = line.lower()
        if ("kwh" in low) or (("total" in low) and ("consumo" in low)):
            jmax = min(len(lines), i + 1 + lookahead_lines)
            window_lines = lines[i:jmax]
            window_lines = [ln for ln in window_lines if not _is_equivalence_or_unit_line(ln)]
            if not window_lines:
                continue
            window = " ".join(window_lines)
            m1 = re.search(r"(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*kwh\b", window, flags=re.I)
            if m1:
                report["kwh_candidates"].append( (window[:180], _norm_num(m1.group(1))) )
            m2 = re.search(r"(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{1,2}))\s*(?:€|Eur)\b", window, flags=re.I)
            if m2:
                report["kwh_candidates"].append( (window[:180], _norm_num(m2.group(1))) )

    report["sample_head"] = text[:500]
    report["sample_tail"] = text[-500:]

    return report

# =========================
# Main
# =========================
if __name__ == "__main__":
    if "--debug-euro" in sys.argv:
        os.environ["DEBUG_EURO"] = "1"
        sys.argv.remove("--debug-euro")

    if len(sys.argv) != 2:
        print(json.dumps({"error":"Uso: python inferir_factura.py <pdf_o_carpeta>"}, ensure_ascii=False))
        sys.exit(1)

    ruta = sys.argv[1]

    try:
        expected_json = cargar_esperados_de_json(ruta)

        if os.path.isfile(ruta) and ruta.lower().endswith(".pdf"):
            t0 = time.perf_counter()
            ocr_text = ocr_pdf_to_text(ruta)
            if len(ocr_text) == 0:
                print(json.dumps({"error":"OCR vacío"}, ensure_ascii=False))
                sys.exit(2)

            resultado = infer_from_text(ocr_text)
            if not isinstance(resultado, dict):
                resultado = _empty_out()
            for k in CAMPOS:
                resultado.setdefault(k, "")

            t1 = time.perf_counter()
            print(json.dumps(resultado, ensure_ascii=False))

            nombre = os.path.basename(ruta)
            esperado = expected_json.get(nombre) or esperado_por_nombre(nombre)
            if esperado:
                _ = evaluar_y_mostrar(resultado, esperado, titulo=nombre)
                print(f"⏱️ Tiempo {nombre}: {_fmt_secs(t1 - t0)}")
            else:
                print(f"⏱️ Tiempo {nombre} (sin evaluación): {_fmt_secs(t1 - t0)}")

        elif os.path.isdir(ruta):
            pdfs = [os.path.join(ruta, f) for f in os.listdir(ruta) if f.lower().endswith(".pdf")]
            pdfs.sort()
            if not pdfs:
                print(json.dumps({"error":"La carpeta no contiene PDFs"}, ensure_ascii=False))
                sys.exit(3)

            correctas = 0
            total_eval = 0
            tiempos = []
            print(f"== Procesando carpeta: {ruta} ({len(pdfs)} PDFs) ==")
            t_total0 = time.perf_counter()

            for pdf_path in pdfs:
                nombre = os.path.basename(pdf_path)
                try:
                    t0 = time.perf_counter()
                    ocr_text = ocr_pdf_to_text(pdf_path)
                    if not ocr_text:
                        print(f"[WARN] OCR vacío en {nombre}, se omite evaluación.")
                        continue
                    resultado = infer_from_text(ocr_text)
                    if not isinstance(resultado, dict):
                        resultado = _empty_out()
                    for k in CAMPOS:
                        resultado.setdefault(k, "")
                    t1 = time.perf_counter()
                    tiempos.append(t1 - t0)

                    print(f"\n--- {nombre} ---")
                    print(json.dumps(resultado, ensure_ascii=False))

                    esperado = expected_json.get(nombre) or esperado_por_nombre(nombre)
                    if esperado:
                        ok = evaluar_y_mostrar(resultado, esperado, titulo=nombre)
                        total_eval += 1
                        if ok:
                            correctas += 1
                    else:
                        print("ℹ️ Sin esperado: no se evalúa ACC.")

                    print(f"⏱️ Tiempo {nombre}: {_fmt_secs(t1 - t0)}")

                except Exception as e:
                    print(f"[ERROR] {nombre}: {e}")

            t_total1 = time.perf_counter()

            if total_eval:
                falladas = total_eval - correctas
                print("\n==============================")
                print(f"✅ % de facturas correctas: {100*correctas/total_eval:.2f}%  ({correctas}/{total_eval})")
                print(f"❌ % de facturas falladas: {100*falladas/total_eval:.2f}%  ({falladas}/{total_eval})")
                print(f"⏱️ Tiempo TOTAL carpeta: {_fmt_secs(t_total1 - t_total0)}")
                if tiempos:
                    print(f"⏱️ Tiempo medio por PDF: {_fmt_secs(sum(tiempos)/len(tiempos))}")
                print("==============================")
            else:
                print("\nℹ️ No se evaluó ninguna factura (sin 'esperados').")

        else:
            print(json.dumps({"error":"Ruta no válida: especifique un PDF o una carpeta"}, ensure_ascii=False))
            sys.exit(4)

        # Comprobación OCR:
        if os.path.isfile(ruta) and ruta.lower().endswith(".pdf"):
            dbg = ocr_quality_report(ruta)
            print("\n== OCR DEBUG ==")
            print(json.dumps(dbg, ensure_ascii=False, indent=2))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
