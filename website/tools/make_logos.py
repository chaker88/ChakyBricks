"""Derives the site's logo variants from website/assets/logo.png (the master).

    website/.venv/Scripts/python website/tools/make_logos.py

Writes to website/content/assets: logo-light.png (cropped), logo-dark.png (the navy "Chaky" text and
tagline recoloured for dark backgrounds), icon.png / icon-*.png (the brick-and-laptop mark) and
favicon.ico. All keep a transparent background.
"""

from pathlib import Path

import numpy as np
from PIL import Image

SOURCE = Path(__file__).resolve().parent.parent / "assets" / "logo.png"
ASSETS = Path(__file__).resolve().parent.parent / "content" / "assets"
CROP = (20, 60, 1505, 850)
ICON_CROP = (25, 235, 560, 645)
TEXT_FROM_X = 530
SWOOSH_BELOW_Y = 470
SWOOSH_UNTIL_X = 150


def main() -> None:
    logo = Image.open(SOURCE).convert("RGBA")
    pixels = np.array(logo).astype(np.int32)
    height, width, _ = pixels.shape
    red, blue, alpha = pixels[..., 0], pixels[..., 2], pixels[..., 3]
    bluish = (blue > red + 12) & (red < 110) & (alpha > 0)
    xs = np.arange(width)[None, :].repeat(height, 0)
    ys = np.arange(height)[:, None].repeat(width, 1)

    dark = pixels.copy()
    dark[bluish & (xs >= TEXT_FROM_X), :3] = (238, 243, 250)
    dark[bluish & (xs < SWOOSH_UNTIL_X) & (ys > SWOOSH_BELOW_Y), :3] = (95, 140, 215)

    logo.crop(CROP).save(ASSETS / "logo-light.png")
    Image.fromarray(dark.astype(np.uint8), "RGBA").crop(CROP).save(ASSETS / "logo-dark.png")

    clean = pixels.copy()
    clean[(xs >= TEXT_FROM_X + 4) & (ys < 540), 3] = 0
    icon = Image.fromarray(clean.astype(np.uint8), "RGBA").crop(ICON_CROP)
    side = max(icon.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(icon, ((side - icon.width) // 2, (side - icon.height) // 2))
    square.resize((512, 512), Image.LANCZOS).save(ASSETS / "icon.png")
    for size in (32, 64, 180):
        square.resize((size, size), Image.LANCZOS).save(ASSETS / f"icon-{size}.png")
    square.resize((256, 256), Image.LANCZOS).save(
        ASSETS / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )


if __name__ == "__main__":
    main()
