#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Automated Medical Imaging Pipeline for Thérapeute-App (Micro TDT)
Extracts DICOM/radiology slices from PDFs and images, analyzes findings via Gemini Vision,
generates French 'Ligne Claire' Didactic Master Plates and Contact Sheets,
and uploads them directly to Supabase Storage ('tdt_uploads').
"""

import os
import sys
import json
import math
import shutil
import argparse
import tempfile
import base64
import unicodedata
import time
import requests
import fitz  # PyMuPDF
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

# Colors matching Ligne Claire & FeelProd TDT standard
BG_COLOR = (250, 247, 242)        # #FAF7F2 warm cream
PANEL_BG = (12, 12, 14)           # #0C0C0E deep black
BORDER_COLOR = (235, 217, 200)    # #EBD9C8
TEXT_MAIN = (44, 40, 37)          # #2C2825
TEXT_MUTED = (140, 123, 109)      # #8C7B6D
ALERT_RED = (185, 45, 25)         # #AF2D14
ALERT_BG = (254, 242, 242)
SUCCESS_GREEN = (35, 110, 65)     # #236E41
SUCCESS_BG = (240, 250, 242)
SLATE_BLUE = (40, 85, 125)        # #28557D
SLATE_BG = (240, 246, 250)
OCHRE_TERRA = (189, 97, 60)       # #BD613C
OCHRE_BG = (254, 247, 242)

def load_fonts():
    font_paths = [
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    ]
    path_to_use = None
    is_ttc = False
    for p in font_paths:
        if os.path.exists(p):
            path_to_use = p
            is_ttc = p.endswith(".ttc")
            break

    def get_font(size, is_bold=False):
        if not path_to_use:
            return ImageFont.load_default()
        try:
            if is_ttc:
                return ImageFont.truetype(path_to_use, size, index=1 if is_bold else 0)
            return ImageFont.truetype(path_to_use, size)
        except Exception:
            return ImageFont.load_default()

    return {
        "title": get_font(34, True),
        "subtitle": get_font(19, False),
        "panel_title": get_font(18, True),
        "panel_sub": get_font(13, False),
        "pill_title": get_font(16, True),
        "pill_sub": get_font(13, False),
        "legend_bold": get_font(16, True),
        "legend": get_font(15, False),
    }

def draw_pill(draw, x, y, title, subtitle=None, bg_color=(255, 255, 255, 245),
              title_color=TEXT_MAIN, sub_color=TEXT_MUTED, border_color=None,
              fonts=None, padding_x=14, padding_y=8, radius=8):
    font_pill_title = fonts["pill_title"]
    font_pill_sub = fonts["pill_sub"]

    bbox_t = font_pill_title.getbbox(title)
    w_t = bbox_t[2] - bbox_t[0]
    h_t = bbox_t[3] - bbox_t[1]

    w_s, h_s = 0, 0
    if subtitle:
        bbox_s = font_pill_sub.getbbox(subtitle)
        w_s = bbox_s[2] - bbox_s[0]
        h_s = bbox_s[3] - bbox_s[1]

    total_w = max(w_t, w_s) + 2 * padding_x
    total_h = h_t + (h_s + 4 if subtitle else 0) + 2 * padding_y

    rect = [x, y, x + total_w, y + total_h]
    draw.rounded_rectangle(rect, radius=radius, fill=bg_color, outline=border_color, width=2 if border_color else 0)
    draw.text((x + padding_x, y + padding_y - bbox_t[1]), title, font=font_pill_title, fill=title_color)
    if subtitle:
        draw.text((x + padding_x, y + padding_y + h_t + 4 - bbox_s[1]), subtitle, font=font_pill_sub, fill=sub_color)

    return rect

def draw_arrow_pointer(draw, start_pt, end_pt, color, width=3, arrow_len=14, arrow_angle=26):
    draw.line([start_pt, end_pt], fill=color, width=width)
    dx = end_pt[0] - start_pt[0]
    dy = end_pt[1] - start_pt[1]
    angle = math.atan2(dy, dx)
    angle_rad = math.radians(arrow_angle)
    p1 = (end_pt[0] - arrow_len * math.cos(angle - angle_rad), end_pt[1] - arrow_len * math.sin(angle - angle_rad))
    p2 = (end_pt[0] - arrow_len * math.cos(angle + angle_rad), end_pt[1] - arrow_len * math.sin(angle + angle_rad))
    draw.polygon([end_pt, p1, p2], fill=color)
    sx, sy = start_pt
    draw.ellipse([sx - 4, sy - 4, sx + 4, sy + 4], fill=color)

def call_gemini_vision(gemini_api_key, page_image_paths, patient_name):
    models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]
    
    parts = []
    for p in page_image_paths[:12]:
        with open(p, "rb") as f:
            b64_data = base64.b64encode(f.read()).decode("utf-8")
        parts.append({
            "inlineData": {
                "mimeType": "image/png",
                "data": b64_data
            }
        })

    prompt_text = f"""Tu es un médecin radiologue et enseignant en anatomie clinique et thérapie manuelle TDT (charte Ligne Claire Francophone).
Analyse ces pages de document pour le patient: {patient_name or 'Patient'}.

ÉVALUATION INITIALE :
Ce document contient-il des clichés radiologiques, scanners, IRM, radiographies, scintigraphies ou échographies ?
- Si c'est un document purement administratif (ex: facture, devis, ordonnance textuelle seule sans cliché radiologique), réponds :
{{"is_medical_imaging": false}}

- Si ce document comporte des examens d'imagerie (radiographie, scanner, IRM, arthroscanner, infiltration sous scopie, échographie) :
Identifie avec une extrême rigueur anatomique :
1. "is_medical_imaging": true
2. "exam_title": Le titre officiel complet en français (ex: 'IRM DE L'ÉPAULE GAUCHE', 'IRM DU RACHIS CERVICAL', 'ARTHRO-DISTENSION ÉPAULE DROITE')
3. "exam_date": La date de l'examen (format YYYY-MM-DD ou texte lisible)
4. "physician": Le ou les médecins radiologues signataires
5. "facility": Le centre ou clinique d'imagerie
6. "panels": Sélectionne les 2 ou 3 coupes les plus parlantes et démonstratives (ex: Sagittale T2 médiane, Axiale DP Fat-Sat, Coronale STIR).
   Pour chaque coupe :
   - "page_index": index 0-based de l'image contenant cette coupe
   - "title": Titre en majuscules (ex: 'COUPE AXIALE DP FAT-SAT', 'COUPE SAGITTALE T2')
   - "subtitle": Sous-titre anatomique (ex: 'Fissure céphalique postérieure', 'Kyste arc postérieur C5 12x8mm')
   - "crop_box": [ymin, xmin, ymax, xmax] en coordonnées normalisées de 0 à 1000 pour recadrer la coupe sans texte parasite ni bord noir inutile
   - "annotations": 1 à 3 repères ou lésions à pointer précisément :
     * "title": Titre du repère (ex: 'Fissure osseuse corticale')
     * "subtitle": Explication concise (ex: 'Hypersignal oedémateux sous-cortical')
     * "target_point": [y, x] coordonnées normalisées de 0 à 1000 DANS le crop_box (l'endroit précis de l'anomalie)
     * "category": 
         - 'acute_lesion' (🔴 anneau rouge : fissure, hernie, sténose, kyste algogène)
         - 'integrity' (🟢 vert : intégrité coiffe/tendons, moelle saine, absence de rupture)
         - 'normal_landmark' (🔵 bleu ardoise : repère C1-C2, interligne articulaire, aiguille de ponction)
         - 'chronic_remodeling' (🟠 ocre : remaniement dégénératif, capsulite rétractile, arthrose)
7. "conclusion_summary": Synthèse textuelle fidèle et complète de la conclusion du radiologue (2 à 3 phrases claires).

Réponds STRICTEMENT avec l'objet JSON :
{{
  "is_medical_imaging": true,
  "exam_title": "string",
  "exam_date": "string",
  "physician": "string",
  "facility": "string",
  "panels": [
    {{
      "page_index": 0,
      "title": "string",
      "subtitle": "string",
      "crop_box": [0, 0, 1000, 1000],
      "annotations": [
        {{
          "title": "string",
          "subtitle": "string",
          "target_point": [500, 500],
          "category": "acute_lesion"
        }}
      ]
    }}
  ],
  "conclusion_summary": "string"
}}
"""
    parts.append({"text": prompt_text})

    last_error = None
    for model_name in models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_api_key}"
        payload = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "maxOutputTokens": 8192
            }
        }
        try:
            resp = requests.post(url, json=payload, timeout=90)
            if resp.status_code == 200:
                data = resp.json()
                raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
                return json.loads(raw_text)
            else:
                last_error = f"{model_name} HTTP {resp.status_code}: {resp.text}"
        except Exception as e:
            last_error = f"{model_name} error: {str(e)}"
            continue

    raise Exception(f"Gemini Vision API error with all models: {last_error}")

def generate_master_plate(analysis, rendered_pages, output_path, patient_name):
    fonts = load_fonts()
    canvas_w = 2600
    canvas_h = 1650
    canvas = Image.new("RGB", (canvas_w, canvas_h), BG_COLOR)
    draw = ImageDraw.Draw(canvas)

    # Header
    draw.rectangle([0, 0, canvas_w, 130], fill=(255, 255, 255))
    draw.line([(0, 130), (canvas_w, 130)], fill=BORDER_COLOR, width=2)
    
    exam_title = analysis.get("exam_title", "EXAMEN D'IMAGERIE MÉDICALE").upper()
    display_patient = patient_name.upper() if patient_name else "PATIENT"
    header_main = f"PLANCHE DIDACTIQUE — {exam_title} — {display_patient}"
    draw.text((50, 22), header_main, font=fonts["title"], fill=TEXT_MAIN)

    date_str = analysis.get("exam_date", "")
    physician = analysis.get("physician", "")
    facility = analysis.get("facility", "")
    sub_parts = []
    if date_str: sub_parts.append(f"Date: {date_str}")
    if physician: sub_parts.append(physician)
    if facility: sub_parts.append(facility)
    sub_parts.append("Analyse Clinique & Pointage Ligne Claire TDT")
    draw.text((50, 78), " • ".join(sub_parts), font=fonts["subtitle"], fill=TEXT_MUTED)

    # Panels layout
    panels_data = analysis.get("panels", [])[:3]
    if not panels_data:
        canvas.save(output_path, quality=95)
        return

    num_panels = len(panels_data)
    panel_y = 155
    panel_h = 1150
    margin_x = 420
    available_w = canvas_w - (2 * margin_x)
    gap = 25
    panel_w = int((available_w - (num_panels - 1) * gap) / num_panels)

    left_callouts = []
    right_callouts = []

    for i, p_info in enumerate(panels_data):
        p_x = margin_x + i * (panel_w + gap)
        draw.rounded_rectangle([p_x, panel_y, p_x + panel_w, panel_y + panel_h], radius=14, fill=PANEL_BG, outline=BORDER_COLOR, width=2)
        
        draw.rectangle([p_x + 2, panel_y + 2, p_x + panel_w - 2, panel_y + 65], fill=(22, 22, 26))
        draw.text((p_x + 16, panel_y + 12), p_info.get("title", f"VUE {i+1}"), font=fonts["panel_title"], fill=(255, 255, 255))
        draw.text((p_x + 16, panel_y + 38), p_info.get("subtitle", ""), font=fonts["panel_sub"], fill=(175, 175, 175))

        p_idx = p_info.get("page_index", 0)
        if p_idx < len(rendered_pages):
            src_img = Image.open(rendered_pages[p_idx])
            sw, sh = src_img.size
            cb = p_info.get("crop_box", [0, 0, 1000, 1000])
            ymin = int(cb[0] * sh / 1000.0)
            xmin = int(cb[1] * sw / 1000.0)
            ymax = int(cb[2] * sh / 1000.0)
            xmax = int(cb[3] * sw / 1000.0)

            xmin = max(0, min(xmin, sw - 10))
            ymin = max(0, min(ymin, sh - 10))
            xmax = max(xmin + 10, min(xmax, sw))
            ymax = max(ymin + 10, min(ymax, sh))

            crop = src_img.crop((xmin, ymin, xmax, ymax))
            
            # Subtle contrast enhancement to emphasize bone/tissue interfaces
            enhancer = ImageEnhance.Contrast(crop)
            crop = enhancer.enhance(1.12)
            
            crop_resized = crop.resize((panel_w - 16, panel_h - 85), Image.Resampling.LANCZOS)
            canvas.paste(crop_resized, (p_x + 8, panel_y + 75))

            img_x_offset = p_x + 8
            img_y_offset = panel_y + 75
            img_w = panel_w - 16
            img_h = panel_h - 85

            for ann in p_info.get("annotations", []):
                t_pt = ann.get("target_point", [500, 500])
                tx = img_x_offset + int(t_pt[1] * img_w / 1000.0)
                ty = img_y_offset + int(t_pt[0] * img_h / 1000.0)
                
                cat = ann.get("category", "acute_lesion")
                if cat == "acute_lesion":
                    color = ALERT_RED
                    bg_col = ALERT_BG
                elif cat == "integrity":
                    color = SUCCESS_GREEN
                    bg_col = SUCCESS_BG
                elif cat == "chronic_remodeling":
                    color = OCHRE_TERRA
                    bg_col = OCHRE_BG
                else:
                    color = SLATE_BLUE
                    bg_col = SLATE_BG

                draw.ellipse([tx - 16, ty - 16, tx + 16, ty + 16], outline=color, width=3)
                draw.ellipse([tx - 3, ty - 3, tx + 3, ty + 3], fill=color)

                callout_entry = {
                    "title": ann.get("title", ""),
                    "subtitle": ann.get("subtitle", ""),
                    "target_x": tx,
                    "target_y": ty,
                    "color": color,
                    "bg_color": bg_col,
                    "panel_index": i
                }

                if i == 0 or (i == 1 and len(left_callouts) < 3):
                    left_callouts.append(callout_entry)
                else:
                    right_callouts.append(callout_entry)

    y_step_l = int((panel_h - 100) / max(1, len(left_callouts)))
    for idx, c in enumerate(left_callouts):
        cy = panel_y + 80 + idx * y_step_l
        pill_rect = draw_pill(draw, 45, cy, c["title"], c["subtitle"],
                              bg_color=c["bg_color"], title_color=c["color"], sub_color=c["color"],
                              border_color=c["color"], fonts=fonts)
        draw_arrow_pointer(draw, (pill_rect[2], pill_rect[1] + 24), (c["target_x"], c["target_y"]), c["color"], width=3)

    y_step_r = int((panel_h - 100) / max(1, len(right_callouts)))
    for idx, c in enumerate(right_callouts):
        cy = panel_y + 80 + idx * y_step_r
        pill_rect = draw_pill(draw, canvas_w - 380, cy, c["title"], c["subtitle"],
                              bg_color=c["bg_color"], title_color=c["color"], sub_color=c["color"],
                              border_color=c["color"], fonts=fonts)
        draw_arrow_pointer(draw, (pill_rect[0], pill_rect[1] + 24), (c["target_x"], c["target_y"]), c["color"], width=3)

    # Footer Banner
    footer_rect = [40, canvas_h - 130, canvas_w - 40, canvas_h - 20]
    draw.rounded_rectangle(footer_rect, radius=12, fill=(255, 255, 255), outline=BORDER_COLOR, width=2)
    
    footer_title = f"SYNTHÈSE DU COMPTE-RENDU RADIOLOGIQUE ({physician or 'Radiologue Référent'}) :"
    draw.text((65, canvas_h - 118), footer_title, font=fonts["legend_bold"], fill=ALERT_RED)
    
    conc = analysis.get("conclusion_summary", "Examen sans anomalie majeure.")
    lines = conc.split("\n")
    if len(lines) == 1 and len(lines[0]) > 130:
        mid = lines[0].rfind(" ", 0, 130)
        if mid != -1:
            lines = [lines[0][:mid], lines[0][mid+1:]]

    draw.text((65, canvas_h - 88), lines[0] if len(lines) > 0 else conc, font=fonts["legend"], fill=TEXT_MAIN)
    if len(lines) > 1:
        draw.text((65, canvas_h - 58), lines[1], font=fonts["legend"], fill=TEXT_MUTED)

    canvas.save(output_path, quality=95)

def generate_contact_sheet(rendered_pages, output_path, exam_title, patient_name):
    fonts = load_fonts()
    num_pages = len(rendered_pages)
    if num_pages == 0:
        return

    cols = 4 if num_pages >= 4 else num_pages
    rows = math.ceil(num_pages / cols)

    cell_w = 600
    cell_h = 750
    header_h = 120
    margin = 30
    canvas_w = margin * 2 + cols * cell_w + (cols - 1) * margin
    canvas_h = header_h + margin + rows * cell_h + (rows - 1) * margin + 40

    canvas = Image.new("RGB", (canvas_w, canvas_h), (18, 18, 20))
    draw = ImageDraw.Draw(canvas)

    draw.rectangle([0, 0, canvas_w, header_h], fill=(26, 26, 30))
    draw.line([(0, header_h), (canvas_w, header_h)], fill=(60, 60, 65), width=2)
    draw.text((margin, 25), f"PLANCHE DE CONTACT INTÉGRALE — {exam_title.upper()} — {patient_name.upper()}", font=fonts["title"], fill=(255, 255, 255))
    draw.text((margin, 75), f"{num_pages} séries / coupes haute résolution numérisées sans recadrage", font=fonts["subtitle"], fill=(180, 180, 180))

    for idx, p_path in enumerate(rendered_pages):
        r = idx // cols
        c = idx % cols
        x = margin + c * (cell_w + margin)
        y = header_h + margin + r * (cell_h + margin)

        draw.rounded_rectangle([x, y, x + cell_w, y + cell_h], radius=10, fill=(10, 10, 12), outline=(50, 50, 55), width=2)
        draw.rectangle([x + 2, y + 2, x + cell_w - 2, y + 40], fill=(35, 35, 40))
        draw.text((x + 14, y + 10), f"Page / Coupe {idx + 1}", font=fonts["panel_title"], fill=(220, 220, 220))

        src = Image.open(p_path)
        fitted = src.resize((cell_w - 16, cell_h - 55), Image.Resampling.LANCZOS)
        canvas.paste(fitted, (x + 8, y + 46))

    canvas.save(output_path, quality=92)

def upload_to_supabase(file_path, dest_name, supabase_url, supabase_key):
    url = f"{supabase_url}/storage/v1/object/tdt_uploads/{dest_name}"
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "image/png",
        "x-upsert": "true"
    }
    with open(file_path, "rb") as f:
        resp = requests.post(url, headers=headers, data=f.read())
        if resp.status_code not in (200, 201):
            ts = int(os.path.getmtime(file_path))
            dest_name_alt = f"{os.path.splitext(dest_name)[0]}_{ts}.png"
            url_alt = f"{supabase_url}/storage/v1/object/tdt_uploads/{dest_name_alt}"
            with open(file_path, "rb") as f2:
                resp2 = requests.post(url_alt, headers=headers, data=f2.read())
                if resp2.status_code in (200, 201):
                    return f"{supabase_url}/storage/v1/object/public/tdt_uploads/{dest_name_alt}"
            raise Exception(f"Supabase Storage upload error {resp.status_code}: {resp.text}")
            
    return f"{supabase_url}/storage/v1/object/public/tdt_uploads/{dest_name}"

def main():
    parser = argparse.ArgumentParser(description="Process medical PDF or image to Ligne Claire plates")
    parser.add_argument("--input-path", "--pdf-path", dest="input_path", required=True, help="Path to input PDF or image file")
    parser.add_argument("--consultation-id", required=True, help="Consultation UUID")
    parser.add_argument("--patient-name", default="Patient", help="Patient full name")
    parser.add_argument("--gemini-key", default=os.getenv("GEMINI_API_KEY", ""), help="Gemini API Key")
    parser.add_argument("--supabase-url", default=os.getenv("NEXT_PUBLIC_SUPABASE_URL", ""), help="Supabase URL")
    parser.add_argument("--supabase-key", default=os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ""), help="Supabase Key")
    parser.add_argument("--dpi-zoom", type=float, default=2.5, help="PyMuPDF zoom factor")
    args = parser.parse_args()

    if not os.path.exists(args.input_path):
        print(json.dumps({"error": f"Input file not found: {args.input_path}"}))
        sys.exit(1)

    temp_dir = tempfile.mkdtemp(prefix="tdt_med_")
    try:
        rendered_pages = []
        ext = os.path.splitext(args.input_path)[1].lower()

        if ext == ".pdf":
            doc = fitz.open(args.input_path)
            mat = fitz.Matrix(args.dpi_zoom, args.dpi_zoom)
            for i in range(len(doc)):
                page = doc.load_page(i)
                pix = page.get_pixmap(matrix=mat)
                page_png = os.path.join(temp_dir, f"page_{i+1}.png")
                pix.save(page_png)
                rendered_pages.append(page_png)
        else:
            # Direct image file
            im = Image.open(args.input_path).convert("RGB")
            page_png = os.path.join(temp_dir, "page_1.png")
            im.save(page_png, quality=95)
            rendered_pages.append(page_png)

        if len(rendered_pages) == 0:
            print(json.dumps({"error": "No renderable pages found in document."}))
            sys.exit(1)

        analysis = call_gemini_vision(args.gemini_key, rendered_pages, args.patient_name)

        if not analysis.get("is_medical_imaging", True):
            print(json.dumps({
                "success": False,
                "is_medical_imaging": False,
                "message": "Document administratif ou texte sans clichés radiologiques."
            }))
            sys.exit(0)

        exam_title = analysis.get("exam_title", "Examen Radio")
        clean_title = unicodedata.normalize('NFKD', exam_title).encode('ascii', 'ignore').decode('ascii')
        slug = "".join([c if (c.isalnum() and c.isascii()) else "_" for c in clean_title.lower()]).strip("_")[:25]
        while "__" in slug:
            slug = slug.replace("__", "_")
        if not slug:
            slug = "radio_exam"

        master_plate_local = os.path.join(temp_dir, f"planche_maitresse_{slug}.png")
        generate_master_plate(analysis, rendered_pages, master_plate_local, args.patient_name)

        contact_sheet_local = os.path.join(temp_dir, f"planche_contact_{slug}.png")
        generate_contact_sheet(rendered_pages, contact_sheet_local, exam_title, args.patient_name)

        ts = int(time.time())
        master_dest = f"radio_planche_didactique_{slug}_{ts}_{args.consultation_id}.png"
        contact_dest = f"radio_planche_contact_{slug}_{ts}_{args.consultation_id}.png"

        master_url = upload_to_supabase(master_plate_local, master_dest, args.supabase_url, args.supabase_key)
        contact_url = upload_to_supabase(contact_sheet_local, contact_dest, args.supabase_url, args.supabase_key)

        output_res = {
            "success": True,
            "is_medical_imaging": True,
            "exam_title": exam_title,
            "exam_date": analysis.get("exam_date", ""),
            "physician": analysis.get("physician", ""),
            "facility": analysis.get("facility", ""),
            "master_plate_url": master_url,
            "contact_sheet_url": contact_url,
            "conclusion_summary": analysis.get("conclusion_summary", ""),
            "panels_count": len(analysis.get("panels", []))
        }
        print(json.dumps(output_res))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == "__main__":
    main()
