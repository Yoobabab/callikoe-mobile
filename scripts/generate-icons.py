"""Génère les icônes Callikoe (fond sombre + point dégradé). Usage : python3 scripts/generate-icons.py"""
import os
from PIL import Image, ImageDraw

BG = (0x16, 0x14, 0x1A, 255)
STOPS = [(0.0, (0xF2, 0x6B, 0x4F)), (0.5, (0xD8, 0x14, 0x1C)), (1.0, (0xE0, 0x00, 0x6E))]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def color_at(t):
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t <= t1:
            return lerp(c0, c1, (t - t0) / (t1 - t0))
    return STOPS[-1][1]


def gradient_dot(size, ratio, bg):
    ss = 4  # suréchantillonnage pour un bord lisse
    big = size * ss
    grad = Image.new("RGBA", (big, big))
    px = grad.load()
    for y in range(big):
        for x in range(big):
            t = (x + y) / (2 * (big - 1))  # diagonale haut-gauche -> bas-droite
            px[x, y] = color_at(t) + (255,)
    mask = Image.new("L", (big, big), 0)
    r = big * ratio / 2
    c = big / 2
    ImageDraw.Draw(mask).ellipse((c - r, c - r, c + r, c + r), fill=255)
    img = Image.new("RGBA", (big, big), bg)
    img.paste(grad, (0, 0), mask)
    return img.resize((size, size), Image.LANCZOS)


def main():
    n = 1024
    # Calcul pixel par pixel en suréchantillonnage : compter ~2 minutes.
    gradient_dot(n, 0.56, BG).convert("RGB").save(os.path.join(OUT, "icon.png"))
    gradient_dot(n, 0.42, BG).convert("RGB").save(os.path.join(OUT, "splash-icon.png"))
    gradient_dot(n, 0.40, (0, 0, 0, 0)).save(os.path.join(OUT, "adaptive-icon.png"))
    gradient_dot(48, 0.80, BG).convert("RGB").save(os.path.join(OUT, "favicon.png"))
    print("Icônes générées dans", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
