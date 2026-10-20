#!/usr/bin/env python3
"""Render a branded 1080x1350 vacancy poster (JPEG) with Pillow.

Usage: render-poster.py <input.json> <output.jpg>
input.json: {"title","company","location","closing","apply","tag"}
"""
import json, os, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1350
NAVY, ACCENT, WHITE, SOFT = (7, 50, 101), (108, 93, 255), (255, 255, 255), (206, 218, 238)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu", "/usr/share/fonts/truetype/liberation"]


def font(bold, size):
    names = ["DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf", "LiberationSans-Bold.ttf" if bold else "LiberationSans-Regular.ttf"]
    for d in FONT_DIRS:
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def wrap(draw, text, fnt, max_w, max_lines):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= max_w:
            cur = t
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(". ") + "…"
    return lines


def main(src, out):
    d = json.load(open(src, encoding="utf8"))
    title = (d.get("title") or "Vacancy").strip()
    company = (d.get("company") or "").strip()
    location = (d.get("location") or "South Africa").strip()
    closing = (d.get("closing") or "").strip()
    apply_txt = (d.get("apply") or "Apply on SA Recruiters").strip()
    tag = (d.get("tag") or "NOW HIRING").strip().upper()

    img = Image.new("RGB", (W, H), NAVY)
    # soft diagonal accent shape
    over = Image.new("RGB", (W, H), NAVY)
    od = ImageDraw.Draw(over)
    od.polygon([(W * 0.45, 0), (W, 0), (W, H * 0.62)], fill=(18, 70, 135))
    od.ellipse([-260, H - 520, 520, H + 260], fill=(14, 60, 118))
    img = Image.blend(img, over, 1.0)
    dr = ImageDraw.Draw(img)

    # header: logo + brand
    x = 70
    logo = os.path.join(ROOT, "icons", "logo-152.webp")
    if os.path.exists(logo):
        lg = Image.open(logo).convert("RGBA").resize((84, 84))
        img.paste(lg, (x, 62), lg)
        x += 104
    dr.text((x, 70), "SA Recruiters", font=font(True, 38), fill=WHITE)
    dr.text((x, 118), "Connecting SA's Recruitment Community", font=font(False, 22), fill=SOFT)

    # tag pill
    tf = font(True, 34)
    tw = dr.textlength(tag, font=tf)
    dr.rounded_rectangle([70, 250, 70 + tw + 64, 250 + 70], radius=35, fill=ACCENT)
    dr.text((70 + 32, 250 + 14), tag, font=tf, fill=WHITE)

    # title (auto-shrink to fit 4 lines)
    y, size = 360, 92
    while True:
        tf = font(True, size)
        lines = wrap(dr, title, tf, W - 140, 4)
        if len(lines) <= 3 or size <= 60: break
        size -= 6
    lines = wrap(dr, title, tf, W - 140, 4)
    for ln in lines:
        dr.text((70, y), ln, font=tf, fill=WHITE)
        y += int(size * 1.18)

    if company:
        y += 18
        cf = font(True, 46)
        for ln in wrap(dr, company, cf, W - 140, 2):
            dr.text((70, y), ln, font=cf, fill=(190, 178, 255))
            y += 60

    # info rows
    y = max(y + 50, 800)
    rows = [("LOCATION", location)]
    if closing:
        rows.append(("CLOSING DATE", closing))
    for label, val in rows:
        dr.text((70, y), label, font=font(True, 24), fill=SOFT)
        vf = font(True, 44)
        for ln in wrap(dr, val, vf, W - 140, 2):
            dr.text((70, y + 34), ln, font=vf, fill=WHITE)
            y += 56
        y += 62

    # CTA bar
    bar_y = H - 260
    dr.rounded_rectangle([70, bar_y, W - 70, bar_y + 120], radius=60, fill=WHITE)
    cf = font(True, 40)
    cw = dr.textlength(apply_txt, font=cf)
    dr.text(((W - cw) / 2, bar_y + 36), apply_txt, font=cf, fill=NAVY)
    foot = "Free job alerts  •  Install the SA Recruiters app"
    ff = font(False, 26)
    fw = dr.textlength(foot, font=ff)
    dr.text(((W - fw) / 2, H - 100), foot, font=ff, fill=SOFT)

    img.save(out, "JPEG", quality=88, optimize=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
