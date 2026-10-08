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
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    ]
    bold_paths = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    ]
    path_to_use = None
    is_ttc = False
    for p in font_paths:
        if os.path.exists(p):
            path_to_use = p
            is_ttc = p.endswith(".ttc")
            break

    bold_to_use = None
    bold_is_ttc = False
    for p in bold_paths:
        if os.path.exists(p):
            bold_to_use = p
            bold_is_ttc = p.endswith(".ttc")
            break

    def get_font(path, is_ttc_flag, size, is_bold=False):
        if not path:
            return ImageFont.load_default()
        try:
            if is_ttc_flag:
                return ImageFont.truetype(path, size, index=1 if is_bold else 0)
            return ImageFont.truetype(path, size)
        except Exception:
            return ImageFont.load_default()

    return {
        "title": get_font(bold_to_use or path_to_use, bold_is_ttc, 23, True),
        "subtitle": get_font(path_to_use, is_ttc, 13, False),
        "panel_title": get_font(bold_to_use or path_to_use, bold_is_ttc, 14, True),
        "panel_sub": get_font(path_to_use, is_ttc, 11, False),
        "badge": get_font(bold_to_use or path_to_use, bold_is_ttc, 11, True),
        "num": get_font(bold_to_use or path_to_use, bold_is_ttc, 12, True),
        "card_title": get_font(bold_to_use or path_to_use, bold_is_ttc, 13, True),
        "card_desc": get_font(path_to_use, is_ttc, 11, False),
        "syn_badge": get_font(bold_to_use or path_to_use, bold_is_ttc, 12, True),
        "syn_body": get_font(path_to_use, is_ttc, 12, False),
        "pill_title": get_font(bold_to_use or path_to_use, bold_is_ttc, 14, True),
        "pill_sub": get_font(path_to_use, is_ttc, 11, False),
        "legend_bold": get_font(bold_to_use or path_to_use, bold_is_ttc, 14, True),
        "legend": get_font(path_to_use, is_ttc, 12, False),
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
Ce document contient-il des clichés radiologiques, scanners, IRM, radiographies, scintigraphies ou échographies VISUELLES (photographies d'imagerie médicale découpables) ?
- Si c'est un compte-rendu médical purement textuel (paragraphes de texte dactylographié sur fond blanc sans cliché photographique d'imagerie), ou un document administratif, ordonnance, facture :
Réponds OBLIGATOIREMENT :
{{"is_medical_imaging": false}}

- Si et seulement si ce document comporte de VRAIS CLICHÉS D'IMAGERIE MÉDICALE photographiques ou coupes DICOM découpables :
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
   - "annotations": 2 à 3 repères ou lésions à pointer précisément :
     * "title": Titre du repère (ex: 'Fissure osseuse corticale')
     * "subtitle": Explication concise (ex: 'Hypersignal oedémateux sous-cortical')
     * "target_point": [y, x] coordonnées normalisées de 0 à 1000 DANS le crop_box (l'endroit précis de l'anomalie)
       ATTENTION RÈGLES RADIOLOGIQUES CRITIQUES :
       - LATÉRALITÉ RADIOLOGIQUE STRICTE : En coupe axiale ou coronale de face, la DROITE anatomique du patient est à GAUCHE de l'image (x < 500), et la GAUCHE du patient est à DROITE de l'image (x > 500). En coupe sagittale, repère scrupuleusement la face antérieure et postérieure.
       - PRÉCISION CHIRURGICALE : target_point [y, x] doit pointer EXACTEMENT dans la structure cible (dans l'épaisseur du tendon, dans la bourse séreuse, dans la lumière vasculaire ou du calcul, sur la corticale fracturée). Ne JAMAIS pointer dans l'os spongieux normal, dans le vide ou sur du texte.
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

def wrap_text_lines(text, max_chars=75):
    if not text:
        return []
    words = text.split()
    lines = []
    current_line = []
    current_len = 0
    for w in words:
        if current_len + len(w) + 1 > max_chars:
            if current_line:
                lines.append(" ".join(current_line))
            current_line = [w]
            current_len = len(w)
        else:
            current_line.append(w)
            current_len += len(w) + 1
    if current_line:
        lines.append(" ".join(current_line))
    return lines

def generate_master_plate(analysis, rendered_pages, output_path, patient_name):
    fonts = load_fonts()
    canvas_w = 1600
    canvas_h = 1040
    canvas = Image.new("RGB", (canvas_w, canvas_h), (250, 247, 242))  # #FAF7F2 warm cream
    draw = ImageDraw.Draw(canvas)

    # 1. Header
    margin_x = 45
    exam_title = analysis.get("exam_title", "EXAMEN D'IMAGERIE MÉDICALE").upper()
    display_patient = patient_name.upper() if patient_name else "PATIENT"
    header_main = f"PLANCHE DIDACTIQUE — {exam_title} — {display_patient}"
    draw.text((margin_x, 26), header_main, font=fonts["title"], fill="#0F172A")

    date_str = analysis.get("exam_date", "")
    physician = analysis.get("physician", "")
    facility = analysis.get("facility", "")
    sub_parts = []
    if date_str: sub_parts.append(f"Date: {date_str}")
    if physician: sub_parts.append(physician)
    if facility: sub_parts.append(facility)
    sub_parts.append("Analyse Clinique & Pointage Ligne Claire TDT")
    draw.text((margin_x, 58), " • ".join(sub_parts), font=fonts["subtitle"], fill="#64748B")
    draw.line([(margin_x, 86), (canvas_w - margin_x, 86)], fill="#E2E8F0", width=1)

    # 2. Panels layout (Golden Layout - Bottom Card Pattern, Zero Crossing Lines)
    panels_data = analysis.get("panels", [])[:3]
    if not panels_data:
        canvas.save(output_path, quality=95)
        return

    num_panels = len(panels_data)
    available_w = canvas_w - (2 * margin_x)
    gap = 25 if num_panels >= 3 else 35
    pan_w = int((available_w - (num_panels - 1) * gap) / num_panels)
    pan_y = 102
    pan_h = 490

    for i, p_info in enumerate(panels_data):
        p_x = margin_x + i * (pan_w + gap)

        # Panel container
        draw.rounded_rectangle([(p_x, pan_y), (p_x + pan_w, pan_y + pan_h)], radius=12, fill="#FFFFFF", outline="#E2E8F0", width=1)
        # Panel header bar
        draw.rounded_rectangle([(p_x, pan_y), (p_x + pan_w, pan_y + 46)], radius=12, fill="#F8FAFC", outline="#E2E8F0", width=1)
        draw.rectangle([(p_x, pan_y + 36), (p_x + pan_w, pan_y + 46)], fill="#F8FAFC")
        
        view_title = p_info.get("title", f"VUE {i+1}").upper()
        view_sub = p_info.get("subtitle", "")
        draw.text((p_x + 16, pan_y + 10), view_title, fill="#1E293B", font=fonts["panel_title"])
        draw.text((p_x + 16, pan_y + 28), view_sub, fill="#64748B", font=fonts["panel_sub"])

        # Orientation / Lateralite pill badge
        header_text_combined = f"{view_title} {view_sub}".lower()
        if "axial" in header_text_combined:
            badge_text = "DROITE (PAT.) | GAUCHE (PAT.)"
            badge_col = "#BE123C"
            badge_bg = "#FFF1F2"
            badge_border = "#FDA4AF"
        elif "sagitt" in header_text_combined:
            badge_text = "PLAN SAGITTAL"
            badge_col = "#475569"
            badge_bg = "#F1F5F9"
            badge_border = "#CBD5E1"
        elif "coron" in header_text_combined or "front" in header_text_combined:
            badge_text = "PLAN FRONTAL / CORONAL"
            badge_col = "#047857"
            badge_bg = "#ECFDF5"
            badge_border = "#A7F3D0"
        else:
            badge_text = f"COUPE {i+1}"
            badge_col = "#1D4ED8"
            badge_bg = "#EFF6FF"
            badge_border = "#93C5FD"

        bbox_badge = fonts["badge"].getbbox(badge_text)
        b_w = (bbox_badge[2] - bbox_badge[0]) + 18
        b_x = p_x + pan_w - b_w - 12
        draw.rounded_rectangle([(b_x, pan_y + 12), (b_x + b_w, pan_y + 34)], radius=6, fill=badge_bg, outline=badge_border, width=1)
        draw.text((b_x + 9, pan_y + 16), badge_text, fill=badge_col, font=fonts["badge"])

        # Image Crop & Display
        p_idx = p_info.get("page_index", 0)
        c_w, c_h = pan_w - 16, pan_h - 58
        im_x, im_y = p_x + 8, pan_y + 50
        
        if p_idx < len(rendered_pages):
            try:
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
                enhancer = ImageEnhance.Contrast(crop)
                crop = enhancer.enhance(1.10)

                max_w = pan_w - 16
                max_h = pan_h - 58
                scale = min(max_w / max(1, crop.width), max_h / max(1, crop.height))
                c_w = max(10, int(crop.width * scale))
                c_h = max(10, int(crop.height * scale))
                crop_resized = crop.resize((c_w, c_h), Image.Resampling.LANCZOS)
                
                im_x = p_x + (pan_w - c_w) // 2
                im_y = pan_y + 50 + (max_h - c_h) // 2
                canvas.paste(crop_resized, (im_x, im_y))
            except Exception as e:
                pass

        # Targets on Image
        anns = p_info.get("annotations", [])[:3]
        for ann_idx, ann in enumerate(anns):
            num_str = str(ann_idx + 1)
            cat = ann.get("category", "acute_lesion")
            if cat == "acute_lesion":
                col_hex = "#AF2D14"
            elif cat == "integrity":
                col_hex = "#236E41"
            elif cat == "chronic_remodeling":
                col_hex = "#BD613C"
            else:
                col_hex = "#1A535C"

            t_pt = ann.get("target_point", [500, 500])
            tx = im_x + int(t_pt[1] * c_w / 1000.0)
            ty = im_y + int(t_pt[0] * c_h / 1000.0)

            tx = max(im_x + 18, min(tx, im_x + c_w - 18))
            ty = max(im_y + 18, min(ty, im_y + c_h - 18))

            r1, r2 = 14, 6
            draw.ellipse([(tx - r1, ty - r1), (tx + r1, ty + r1)], outline=col_hex, width=2)
            draw.ellipse([(tx - r2, ty - r2), (tx + r2, ty + r2)], fill=col_hex)

            off_x = -26 if tx > (im_x + c_w // 2) else 26
            off_y = -22 if ty > (im_y + c_h // 2) else 22
            bx, by = tx + off_x, ty + off_y
            draw.line([(tx + (r1 if off_x > 0 else -r1), ty), (bx, by)], fill=col_hex, width=2)
            draw.rounded_rectangle([(bx - 11, by - 10), (bx + 11, by + 10)], radius=5, fill=col_hex)
            draw.text((bx - 4, by - 7), num_str, fill="#FFFFFF", font=fonts["num"])

        # Dedicated Didactic Cards directly beneath each panel (Zero Crossing Lines)
        card_y_start = pan_y + pan_h + 12
        card_h = 72
        card_gap = 8
        max_chars = 52 if num_panels >= 3 else 82

        for ann_idx, ann in enumerate(anns):
            cy = card_y_start + ann_idx * (card_h + card_gap)
            num_str = str(ann_idx + 1)
            cat = ann.get("category", "acute_lesion")
            if cat == "acute_lesion":
                col_hex = "#AF2D14"
            elif cat == "integrity":
                col_hex = "#236E41"
            elif cat == "chronic_remodeling":
                col_hex = "#BD613C"
            else:
                col_hex = "#1A535C"

            draw.rounded_rectangle([(p_x, cy), (p_x + pan_w, cy + card_h)], radius=10, fill="#FFFFFF", outline="#E2E8F0", width=1)
            draw.rounded_rectangle([(p_x + 12, cy + 12), (p_x + 36, cy + 36)], radius=6, fill=col_hex)
            draw.text((p_x + 20, cy + 17), num_str, fill="#FFFFFF", font=fonts["num"])
            
            title_text = ann.get("title", "")
            draw.text((p_x + 44, cy + 12), title_text[:50], fill="#1E293B", font=fonts["card_title"])

            desc_lines = wrap_text_lines(ann.get("subtitle", ""), max_chars=max_chars)[:2]
            for l_idx, dl in enumerate(desc_lines):
                draw.text((p_x + 44, cy + 34 + l_idx * 16), dl, fill="#64748B", font=fonts["card_desc"])

    # 3. Bottom Summary Card (SYNTHÈSE DU COMPTE-RENDU RADIOLOGIQUE & ANALYSE CLINIQUE TDT)
    syn_y = 852
    syn_h = canvas_h - syn_y - 20
    draw.rounded_rectangle([(margin_x, syn_y), (canvas_w - margin_x, syn_y + syn_h)], radius=12, fill="#FFFFFF", outline="#CBD5E1", width=1)
    
    badge_title = f"SYNTHÈSE DU COMPTE-RENDU RADIOLOGIQUE ({physician or 'Radiologue Référent'}) & ANALYSE TDT"
    draw.rounded_rectangle([(margin_x + 15, syn_y + 12), (margin_x + 560, syn_y + 36)], radius=6, fill="#EFF6FF", outline="#93C5FD", width=1)
    draw.text((margin_x + 25, syn_y + 16), badge_title, fill="#1D4ED8", font=fonts["syn_badge"])

    conc = analysis.get("conclusion_summary", "Examen sans anomalie majeure.")
    conc_lines = wrap_text_lines(conc, max_chars=170)[:4]
    for c_idx, cl in enumerate(conc_lines):
        draw.text((margin_x + 25, syn_y + 46 + c_idx * 22), cl, fill="#334155", font=fonts["syn_body"])

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

        if not analysis.get("is_medical_imaging", True) or len(analysis.get("panels", [])) == 0:
            print(json.dumps({
                "success": False,
                "is_medical_imaging": False,
                "message": "Document textuel ou sans clichés radiologiques exploitables découpés."
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
