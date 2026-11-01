#!/usr/bin/env python3
"""Generate MinChat PWA icons (no external deps beyond Pillow)."""
from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'client', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def gradient(size):
    """Diagonal plum -> teal gradient."""
    img = Image.new('RGB', (size, size))
    px = img.load()
    stops = [(0.0, (140, 107, 255)), (0.55, (95, 67, 224)), (1.0, (54, 191, 174))]
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            for i in range(len(stops) - 1):
                a, ca = stops[i]
                b, cb = stops[i + 1]
                if a <= t <= b:
                    f = (t - a) / (b - a)
                    r = int(ca[0] + (cb[0] - ca[0]) * f)
                    g = int(ca[1] + (cb[1] - ca[1]) * f)
                    bl = int(ca[2] + (cb[2] - ca[2]) * f)
                    px[x, y] = (r, g, bl)
                    break
    return img


def rounded_mask(size, radius):
    mask = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def draw_letter(img, ratio=0.56, dy=0.015):
    size = img.size[0]
    d = ImageDraw.Draw(img)
    px = int(size * ratio)
    font = ImageFont.truetype(FONT, px)
    bbox = d.textbbox((0, 0), 'm', font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (size - w) / 2 - bbox[0]
    y = (size - h) / 2 - bbox[1] + size * dy
    # soft shadow
    d.text((x + size * 0.006, y + size * 0.012), 'm', font=font, fill=(30, 18, 70, 120))
    d.text((x, y), 'm', font=font, fill=(255, 255, 255))
    return img


def make(size, name, radius_ratio=0.24, letter=0.56, opaque=False):
    base = gradient(size)
    if radius_ratio > 0:
        mask = rounded_mask(size, int(size * radius_ratio))
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.paste(base, (0, 0), mask)
    else:
        out = base.convert('RGBA')
    draw_letter(out, ratio=letter)
    path = os.path.join(OUT, name)
    out.save(path, 'PNG', optimize=True)
    print('wrote', path, out.size)


for s in (192, 512):
    make(s, f'icon-{s}.png')
make(512, 'maskable-512.png', radius_ratio=0, letter=0.42)
make(180, 'apple-touch-icon.png', radius_ratio=0)
make(32, 'favicon-32.png', radius_ratio=0.24, letter=0.62)
print('done')
