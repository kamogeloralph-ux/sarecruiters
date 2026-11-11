#!/usr/bin/env python3
"""Render the branded 1080x1350 "Vacancy of the Day" poster (JPEG) with Pillow.

Usage: render-poster.py <input.json> <output.jpg>
input.json: {"title","company","location","closing","apply","tag"}

Design: navy header with a diagonal gold edge, a floating white role card,
location / closing-date tiles and an emerald "apply" panel. Everything is
drawn at 2x and downsampled for smooth edges. Fonts: bundled Inter
(assets/fonts), falling back to DejaVu / Liberation if they are missing.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, S = 1080, 1350, 2          # logical size and supersampling factor
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

NAVY, NAVY_2 = (11, 42, 91), (24, 70, 140)
GREEN, GREEN_2 = (0, 122, 94), (0, 160, 122)
GOLD = (245, 180, 0)
INK, MUTED, BG, WHITE = (15, 27, 51), (96, 111, 138), (243, 246, 251), (255, 255, 255)
TINT = (230, 238, 252)

FONT_FILES = {
    "xbold": ["assets/fonts/Inter-ExtraBold.otf"],
    "bold": ["assets/fonts/Inter-SemiBold.otf"],
    "med": ["assets/fonts/Inter-Medium.otf"],
}
FALLBACKS = {
    "xbold": ["DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf"],
    "bold": ["DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf"],
    "med": ["DejaVuSans.ttf", "LiberationSans-Regular.ttf"],
}
FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu", "/usr/share/fonts/truetype/liberation"]


def font(kind, size):
    """Font at logical `size` px (scaled by S)."""
    px = int(size * S)
    for rel in FONT_FILES[kind]:
        p = os.path.join(ROOT, rel)
        if os.path.exists(p):
            return ImageFont.truetype(p, px)
    for d in FONT_DIRS:
        for n in FALLBACKS[kind]:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, px)
    return ImageFont.load_default()


def tlen(draw, text, fnt, track=0):
    return draw.textlength(text, font=fnt) / S + track * max(len(text) - 1, 0)


def wrap(draw, text, fnt, max_w, max_lines):
    """Greedy word wrap. Returns (lines, truncated)."""
    lines, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if tlen(draw, t, fnt) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    if len(lines) <= max_lines:
        return lines, False
    lines = lines[:max_lines]
    last = lines[-1]
    while last and tlen(draw, last + "…", fnt) > max_w:
        last = last[:-1]
    lines[-1] = last.rstrip(" .,;-") + "…"
    return lines, True


def fit(draw, text, kind, start, floor, max_w, max_lines, step=4):
    """Largest font size (start→floor) whose wrapped text fits without truncation."""
    size = start
    while True:
        f = font(kind, size)
        lines, cut = wrap(draw, text, f, max_w, max_lines)
        if not cut or size <= floor:
            return size, f, lines
        size -= step


class Canvas:
    def __init__(self):
        self.img = Image.new("RGBA", (W * S, H * S), BG + (255,))
        self.d = ImageDraw.Draw(self.img)

    def sc(self, box):
        return [int(round(v * S)) for v in box]

    def rect(self, box, fill, r=0):
        if r:
            self.d.rounded_rectangle(self.sc(box), radius=int(r * S), fill=fill)
        else:
            self.d.rectangle(self.sc(box), fill=fill)

    def poly(self, pts, fill):
        self.d.polygon([(int(x * S), int(y * S)) for x, y in pts], fill=fill)

    def circle(self, cx, cy, r, fill):
        self.d.ellipse(self.sc([cx - r, cy - r, cx + r, cy + r]), fill=fill)

    def text(self, xy, s, fnt, fill, track=0, anchor="l"):
        x, y = xy
        if anchor == "c":
            x -= tlen(self.d, s, fnt, track) / 2
        elif anchor == "r":
            x -= tlen(self.d, s, fnt, track)
        if not track:
            self.d.text((x * S, y * S), s, font=fnt, fill=fill)
            return
        for ch in s:
            self.d.text((x * S, y * S), ch, font=fnt, fill=fill)
            x += self.d.textlength(ch, font=fnt) / S + track

    def shadow(self, box, r, blur=22, dy=10, alpha=46):
        pad = blur * 3
        x0, y0, x1, y1 = box
        layer = Image.new("RGBA", (int((x1 - x0 + 2 * pad) * S), int((y1 - y0 + 2 * pad) * S)), (0, 0, 0, 0))
        ImageDraw.Draw(layer).rounded_rectangle(
            [pad * S, pad * S, int((x1 - x0 + pad) * S), int((y1 - y0 + pad) * S)],
            radius=int(r * S), fill=(11, 42, 91, alpha))
        layer = layer.filter(ImageFilter.GaussianBlur(blur * S / 2))
        self.img.alpha_composite(layer, (int((x0 - pad) * S), int((y0 - pad + dy) * S)))
        self.d = ImageDraw.Draw(self.img)

    def card(self, box, r=28, fill=WHITE, **kw):
        self.shadow(box, r, **kw)
        self.rect(box, fill, r)

    def gradient_panel(self, box, r, c1, c2):
        x0, y0, x1, y1 = self.sc(box)
        w, h = x1 - x0, y1 - y0
        grad = Image.new("RGB", (w, h))
        gd = ImageDraw.Draw(grad)
        for i in range(w):
            t = i / max(w - 1, 1)
            gd.line([(i, 0), (i, h)], fill=tuple(int(c1[k] + (c2[k] - c1[k]) * t) for k in range(3)))
        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=int(r * S), fill=255)
        self.img.paste(grad, (x0, y0), mask)
        self.d = ImageDraw.Draw(self.img)

    # ---- simple vector icons, drawn inside a circle centred at (cx, cy) ----
    def icon_pin(self, cx, cy, c):
        self.circle(cx, cy - 4, 9, c)
        self.poly([(cx - 8, cy), (cx + 8, cy), (cx, cy + 15)], c)
        self.circle(cx, cy - 4, 3.6, (255, 255, 255) if c != WHITE else NAVY)

    def icon_calendar(self, cx, cy, c, hole):
        self.rect([cx - 13, cy - 11, cx + 13, cy + 13], c, 4)
        self.rect([cx - 13, cy - 11, cx + 13, cy - 3], c, 4)
        self.rect([cx - 10, cy + 0, cx + 10, cy + 10], hole, 2)
        self.rect([cx - 8, cy - 15, cx - 5, cy - 8], c, 1)
        self.rect([cx + 5, cy - 15, cx + 8, cy - 8], c, 1)
        for gx in (-5, 2):
            for gy in (3, 7):
                self.rect([cx + gx - 1.5, cy + gy - 1.5, cx + gx + 2, cy + gy + 1.5], c, 1)

    def icon_building(self, cx, cy, c, hole):
        self.rect([cx - 11, cy - 14, cx + 11, cy + 14], c, 3)
        for gx in (-6, 2):
            for gy in (-9, -2, 5):
                self.rect([cx + gx, cy + gy, cx + gx + 4, cy + gy + 4], hole, 1)
        self.rect([cx - 3, cy + 9, cx + 3, cy + 14], hole, 1)

    def icon_arrow(self, cx, cy, c):
        self.d.line([(int((cx - 12) * S), int(cy * S)), (int((cx + 10) * S), int(cy * S))], fill=c, width=int(5 * S))
        self.d.line([(int((cx + 1) * S), int((cy - 11) * S)), (int((cx + 11) * S), int(cy * S))], fill=c, width=int(5 * S))
        self.d.line([(int((cx + 1) * S), int((cy + 11) * S)), (int((cx + 11) * S), int(cy * S))], fill=c, width=int(5 * S))
        self.circle(cx + 10.5, cy, 2.5, c)


def paste_logo(cv, rel, x, y, width):
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        return False
    lg = Image.open(p).convert("RGBA")
    h = int(lg.height * (width * S / lg.width))
    lg = lg.resize((int(width * S), h), Image.LANCZOS)
    cv.img.alpha_composite(lg, (int(x * S), int(y * S)))
    cv.d = ImageDraw.Draw(cv.img)
    return True


def main(src, out):
    d = json.load(open(src, encoding="utf8"))
    title = (d.get("title") or "Vacancy").strip()
    company = (d.get("company") or "").strip()
    location = (d.get("location") or "South Africa").strip()
    closing = (d.get("closing") or "").strip()
    apply_txt = (d.get("apply") or "sa-recruiters.co.za").strip()
    if apply_txt.lower().startswith("apply:"):
        apply_txt = apply_txt[6:].strip()
    tag = (d.get("tag") or "Vacancy of the day").strip().upper()

    cv = Canvas()
    dr = cv.d

    # ---------- header ----------
    cv.poly([(0, 0), (W, 0), (W, 300), (0, 372)], GOLD)             # gold edge (drawn first)
    cv.poly([(0, 0), (W, 0), (W, 286), (0, 358)], NAVY)
    cv.circle(W - 70, 40, 250, NAVY_2)                               # soft glow
    for gy in range(0, 5):                                           # dot grid
        for gx in range(0, 9):
            cv.circle(610 + gx * 30, 44 + gy * 30, 3.2, (60, 100, 170))
    # re-clip header: repaint anything that spilled below the diagonal with background
    cv.poly([(0, 358), (W, 286), (W, 372), (0, 372)], GOLD)
    cv.poly([(0, 372), (W, 300), (W, 420), (0, 420)], BG)

    if not paste_logo(cv, "assets/sa-recruiters-logo-400x50-white@2x.png", 60, 62, 330):
        cv.text((60, 62), "SA Recruiters", font("xbold", 38), WHITE)
    dr = cv.d
    pf = font("bold", 24)
    pw = tlen(dr, tag, pf, 3) + 56
    cv.rect([60, 150, 60 + pw, 204], GOLD, 27)
    cv.text((60 + 28, 163), tag, pf, NAVY, track=3)
    cv.text((60, 226), "Fresh opportunity, hand-picked for you", font("med", 24), (176, 196, 232))

    # ---------- role card ----------
    cx0, cx1 = 60, W - 60
    inner_w = cx1 - cx0 - 2 * 48
    size, tf, tlines = fit(dr, title, "xbold", 96, 50, inner_w, 4)
    lh = int(size * 1.16)
    cf_size, cf, clines = (0, None, [])
    if company:
        cf_size, cf, clines = fit(dr, company, "bold", 38, 28, inner_w - 76, 2, step=2)
    content_h = 34 + 26 + lh * len(tlines) + (34 + max(64, len(clines) * 46) if company else 0)
    card_top = 318
    card_h = max(content_h + 2 * 44, 360)
    card = [cx0, card_top, cx1, card_top + card_h]
    cv.card(card, 30)
    cv.rect([cx0 + 48, card_top + 46, cx0 + 48 + 8, card_top + 46 + 30], GREEN, 4)   # accent bar
    cv.text((cx0 + 48 + 24, card_top + 48), "POSITION AVAILABLE", font("bold", 23), MUTED, track=4)

    y = card_top + 44 + 34 + 26
    for ln in tlines:
        cv.text((cx0 + 48, y), ln, tf, INK)
        y += lh
    if company:
        y += 34
        cv.circle(cx0 + 48 + 28, y + 28, 28, (222, 244, 237))
        cv.icon_building(cx0 + 48 + 28, y + 28, GREEN, (222, 244, 237))
        ty = y + 28 - (len(clines) * 46) / 2 + 3
        for ln in clines:
            cv.text((cx0 + 48 + 76, ty), ln, cf, GREEN)
            ty += 46

    # ---------- info tiles ----------
    gap, th, ah = 24, 156, 150
    # spread leftover vertical space evenly between card, tiles, apply panel and footer
    spare = (H - 170) - (card[3] + th + ah)
    vgap = max(28, min(64, spare / 3))
    ty0 = card[3] + vgap
    tw = (cx1 - cx0 - gap) // 2
    tiles = [
        ("pin", "LOCATION", location),
        ("cal", "CLOSING DATE" if closing else "STATUS", closing or "Open for applications"),
    ]
    for i, (kind, label, val) in enumerate(tiles):
        x0 = cx0 + i * (tw + gap)
        cv.card([x0, ty0, x0 + tw, ty0 + th], 24, blur=16, dy=7, alpha=38)
        icx, icy = x0 + 24 + 32, ty0 + th / 2
        cv.circle(icx, icy, 32, TINT)
        if kind == "pin":
            cv.icon_pin(icx, icy - 2, NAVY)
        else:
            cv.icon_calendar(icx, icy, NAVY, TINT)
        vx, vw = x0 + 24 + 64 + 18, tw - 24 - 64 - 18 - 20
        vsize, vf, vlines = fit(dr, val, "bold", 32, 22, vw, 2, step=2)
        block = 28 + len(vlines) * int(vsize * 1.25)
        vy = ty0 + (th - block) / 2
        cv.text((vx, vy), label, font("bold", 19), MUTED, track=2.5)
        vy += 30
        for ln in vlines:
            cv.text((vx, vy), ln, vf, INK)
            vy += int(vsize * 1.25)

    # ---------- apply panel ----------
    ay0 = ty0 + th + vgap
    ay1 = ay0 + ah
    cv.shadow([cx0, ay0, cx1, ay1], 30, blur=20, dy=10, alpha=60)
    cv.gradient_panel([cx0, ay0, cx1, ay1], 30, GREEN, GREEN_2)
    cv.text((cx0 + 44, ay0 + 30), "APPLY NOW AT", font("bold", 22), (200, 240, 228), track=4)
    asz, af, alines = fit(dr, apply_txt, "xbold", 54, 30, cx1 - cx0 - 44 - 150, 1, step=2)
    cv.text((cx0 + 44, ay0 + 66), alines[0], af, WHITE)
    bx, by = cx1 - 44 - 36, (ay0 + ay1) / 2
    cv.circle(bx, by, 36, WHITE)
    cv.icon_arrow(bx - 1, by, GREEN)

    # ---------- footer ----------
    fy = max(ay1 + 34, H - 150)
    paste_logo(cv, "assets/sa-recruiters-logo-400x50-black@2x.png", (W - 260) / 2, fy, 260)
    cv.text((W / 2, fy + 52), "Free job alerts  •  Install the SA Recruiters app", font("med", 23), MUTED, anchor="c")

    img = cv.img.resize((W, H), Image.LANCZOS).convert("RGB")
    img.save(out, "JPEG", quality=90, optimize=True, subsampling=0)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
