#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Automated Medical Imaging Pipeline for Thérapeute-App (Micro TDT)
Extracts DICOM/radiology slices from PDFs, analyzes findings via Gemini Vision,
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
import requests
import fitz  # PyMuPDF
from PIL import Image, ImageDraw, ImageFont

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
    import base64
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_api_key}"
    
    parts = []
    for idx, p in enumerate(page_image_paths[:12]):
        with open(p, "rb") as f:
            b64_data = base64.b64encode(f.read()).decode("utf-8")
        parts.append({
            "inlineData": {
                "mimeType": "image/png",
                "data": b64_data
            }
        })

    prompt_text = f"""Tu es un expert en imagerie médicale et en didactique ostéopathique TDT (charte Ligne Claire Francophone).
Analyse ces pages de l'examen d'imagerie du patient: {patient_name or 'Patient'}.

Identifie:
1. Le titre officiel de l'examen (ex: 'IRM Rachis Lombaire', 'IRM Épaule Gauche', 'Scanner Thoracique')
2. La date de l'examen (format YYYY-MM-DD ou texte)
3. Le médecin radiologue et l'établissement
4. Les 3 coupes les plus parlantes cliniquement (ex: Sagittale T2, Axiale T2 L5-S1, Foraminale droite, Coronale DP FAT SAT).
   Pour chaque coupe sélectionnée:
   - "page_index": index de la page (0-indexed, correspondant à l'ordre des images envoyées)
   - "title": Titre clair de la vue en MAJUSCULES (ex: 'COUPE SAGITTALE T2 MÉDIANE')
   - "subtitle": Sous-titre anatomique (ex: 'Hernie discale descendante L5-S1')
   - "crop_box": [ymin, xmin, ymax, xmax] en coordonnées normalisées de 0 à 1000 sur la page choisie. Sois précis pour isoler la vue d'intérêt sans bordure noire inutile.
   - "annotations": Liste de 1 à 3 repères ou lésions à pointer sur cette coupe:
     * "title": Titre du repère (ex: 'Hernie discale L5-S1')
     * "subtitle": Explication concise clinique (ex: 'Conflit radiculaire direct racine S1 droite')
     * "target_point": [y, x] en coordonnées normalisées de 0 à 1000 sur le crop_box (où placer l'anneau cible)
     * "category": Une valeur parmi 'acute_lesion' (🔴 rouge conflit aigu), 'integrity' (🟢 vert zone saine/libre), 'normal_landmark' (🔵 bleu débord stable), 'chronic_remodeling' (🟠 ocre arthrose/cal osseux).
5. "conclusion_summary": Texte de conclusion officiel du radiologue pour le bandeau inférieur (2 à 3 phrases structurées avec tirets).

Réponds UNIQUEMENT avec un objet JSON strictement conforme à ce schéma:
{{
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

    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "maxOutputTokens": 8192
        }
    }

    resp = requests.post(url, json=payload, timeout=90)
    if resp.status_code != 200:
        raise Exception(f"Gemini Vision API error {resp.status_code}: {resp.text}")
    
    data = resp.json()
    raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(raw_text)

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

                draw.ellipse([tx - 15, ty - 15, tx + 15, ty + 15], outline=color, width=3)
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
        "Content-Type": "image/png"
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
    parser = argparse.ArgumentParser(description="Process medical PDF to Ligne Claire plates")
    parser.add_argument("--pdf-path", required=True, help="Path to input PDF file")
    parser.add_argument("--consultation-id", required=True, help="Consultation UUID")
    parser.add_argument("--patient-name", default="Patient", help="Patient full name")
    parser.add_argument("--gemini-key", default=os.getenv("GEMINI_API_KEY", ""), help="Gemini API Key")
    parser.add_argument("--supabase-url", default=os.getenv("NEXT_PUBLIC_SUPABASE_URL", ""), help="Supabase URL")
    parser.add_argument("--supabase-key", default=os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ""), help="Supabase Key")
    parser.add_argument("--dpi-zoom", type=float, default=2.0, help="PyMuPDF zoom factor")
    args = parser.parse_args()

    if not os.path.exists(args.pdf_path):
        print(json.dumps({"error": f"PDF file not found: {args.pdf_path}"}))
        sys.exit(1)

    temp_dir = tempfile.mkdtemp(prefix="tdt_med_")
    try:
        doc = fitz.open(args.pdf_path)
        rendered_pages = []
        mat = fitz.Matrix(args.dpi_zoom, args.dpi_zoom)
        for i in range(len(doc)):
            page = doc.load_page(i)
            pix = page.get_pixmap(matrix=mat)
            page_png = os.path.join(temp_dir, f"page_{i+1}.png")
            pix.save(page_png)
            rendered_pages.append(page_png)

        if len(rendered_pages) == 0:
            print(json.dumps({"error": "Empty PDF document."}))
            sys.exit(1)

        analysis = call_gemini_vision(args.gemini_key, rendered_pages, args.patient_name)

        exam_title = analysis.get("exam_title", "Examen Radio")
        import unicodedata
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

        import time
        ts = int(time.time())
        master_dest = f"radio_planche_didactique_{slug}_{ts}_{args.consultation_id}.png"
        contact_dest = f"radio_planche_contact_{slug}_{ts}_{args.consultation_id}.png"

        master_url = upload_to_supabase(master_plate_local, master_dest, args.supabase_url, args.supabase_key)
        contact_url = upload_to_supabase(contact_sheet_local, contact_dest, args.supabase_url, args.supabase_key)

        output_res = {
            "success": True,
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
