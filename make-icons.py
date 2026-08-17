#!/usr/bin/env python3
"""Generate PWA / home-screen icons for Yasis Breath Timer.

Creates:
  apple-touch-icon.png     180x180  (iOS home screen, full-bleed, no alpha)
  icon-192.png             192x192  (Android, purpose "any")
  icon-512.png             512x512  (Android, purpose "any")
  icon-maskable-512.png    512x512  (Android, purpose "maskable", safe-zone safe)

Design mirrors the page: dark earth background, one breathing wave with a
sage -> gold -> terracotta gradient stroke and a soft glow.
"""
import math
import os

from PIL import Image, ImageDraw

OUT = os.path.dirname(os.path.abspath(__file__))

SAGE = (143, 167, 126)     # #8FA77E
GOLD = (176, 160, 122)     # #B0A07A
CLAY = (196, 120, 90)      # #C4785A
EARTH_TOP = (46, 38, 28)   # #2E261C
EARTH_MID = (28, 23, 16)   # #1C1710
EARTH_BOT = (15, 13, 9)    # #0F0D09

GRAD = [SAGE, GOLD, CLAY]  # colour stops along the wave, matching #breathGrad

IN, OUT_ = 4, 8
CYCLE = IN + OUT_


def ease(u):
    return 0.5 * (1 - math.cos(math.pi * u))


def wave_points(n, x0, x1, y_top, y_bot):
    """Same curve as the app: ease up for IN beats, ease down for OUT."""
    pts = []
    for i in range(n + 1):
        p = i / n
        h = (ease(p * CYCLE / IN) if p <= IN / CYCLE
             else 1 - ease((p - IN / CYCLE) * CYCLE / OUT_))
        pts.append((x0 + p * (x1 - x0), y_bot - h * (y_bot - y_top)))
    return pts


def colour_at(t):
    """Interpolate along sage -> gold -> clay, t in [0,1]."""
    if t <= 0.33:
        u = t / 0.33
        a, b = GRAD[0], GRAD[1]
    else:
        u = (t - 0.33) / 0.67
        a, b = GRAD[1], GRAD[2]
    return tuple(round(a[i] + (b[i] - a[i]) * u) for i in range(3))


def draw_wave(img, box, stroke, glow_stroke, glow_alpha, n=420):
    """Draw the breathing wave into `box` = (x0, y0, x1, y1)."""
    x0, y0, x1, y1 = box
    pts = wave_points(n, x0, x1, y0, y1)
    d = ImageDraw.Draw(img, "RGBA")
    # soft glow under the stroke
    for k, (px, py) in enumerate(pts):
        c = colour_at(k / n)
        d.ellipse([px - glow_stroke / 2, py - glow_stroke / 2,
                   px + glow_stroke / 2, py + glow_stroke / 2],
                  fill=c + (glow_alpha,))
    # main stroke: overlapping circles = smooth gradient + round caps
    for k, (px, py) in enumerate(pts):
        d.ellipse([px - stroke / 2, py - stroke / 2,
                   px + stroke / 2, py + stroke / 2],
                  fill=colour_at(k / n) + (255,))
    return img


def background(size):
    """Vertical approximation of the page's radial earth gradient."""
    img = Image.new("RGBA", (size, size))
    px = img.load()
    stops = [(0.0, EARTH_TOP), (0.55, EARTH_MID), (1.0, EARTH_BOT)]
    for y in range(size):
        t = y / (size - 1)
        if t <= stops[1][0]:
            u = t / stops[1][0]
            a, b = stops[0][1], stops[1][1]
        else:
            u = (t - stops[1][0]) / (1 - stops[1][0])
            a, b = stops[1][1], stops[2][1]
        c = tuple(round(a[i] + (b[i] - a[i]) * u) for i in range(3))
        for x in range(size):
            px[x, y] = c + (255,)
    return img


def make_icon(size, maskable):
    img = background(size)
    s = size
    if maskable:
        # keep the glyph inside the 80%-diameter safe circle
        box = (0.19 * s, 0.27 * s, 0.81 * s, 0.73 * s)
        stroke = 0.062 * s
    else:
        box = (0.08 * s, 0.22 * s, 0.92 * s, 0.80 * s)
        stroke = 0.066 * s
    draw_wave(img, box, stroke=stroke,
              glow_stroke=stroke * 3.1, glow_alpha=70)
    if maskable:
        img = img.convert("RGB")
    return img.convert("RGB")


def main():
    any512 = make_icon(512, maskable=False)
    any512.save(os.path.join(OUT, "icon-512.png"))
    any512.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, "icon-192.png"))
    any512.resize((180, 180), Image.LANCZOS).save(os.path.join(OUT, "apple-touch-icon.png"))
    make_icon(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"))
    print("wrote: icon-512.png, icon-192.png, apple-touch-icon.png, icon-maskable-512.png")


if __name__ == "__main__":
    main()
