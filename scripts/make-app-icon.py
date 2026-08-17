#!/usr/bin/env python3
"""从产品原图（assets/icon.png，1024 满幅方形）派生 macOS 规范应用图标。

纯平台规范裁形，零设计：原图不动，只改 build/ 派生物。
- macOS（Big Sur+ 规范）：1024 透明画布，内容 824×824 居中（边距 100），
  连续大圆角蒙版（r=185 ≈ 824×0.2247，Apple 比例）。Dock/启动台呈
  标准圆角观感，不再直角方形。
- Windows（icon.ico）不处理：Fluent 规范本就是近方形小圆角，
  原方形派生已符合，保持不动。

产物（幂等，可重复运行）：
- build/icon.png  1024 RGBA 带圆角蒙版（electron-builder mac icon 源）
- build/icon.icns 全尺寸档（iconutil 从 iconset 生成）

用法：python3 scripts/make-app-icon.py（需 Pillow + macOS iconutil）
"""

import math
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'icon.png'

CANVAS = 1024          # 输出画布
CONTENT = 824          # 内容区（Apple Big Sur 比例）
MARGIN = (CANVAS - CONTENT) // 2
RADIUS = round(CONTENT * 0.2247)  # ≈185，Apple 连续圆角的圆形近似

# icns 全档位：文件名 → 实际像素（@2x 后缀是 retina 标注）
ICONS = {
    'icon_16x16.png': 16,
    'icon_16x16@2x.png': 32,
    'icon_32x32.png': 32,
    'icon_32x32@2x.png': 64,
    'icon_128x128.png': 128,
    'icon_128x128@2x.png': 256,
    'icon_256x256.png': 256,
    'icon_256x256@2x.png': 512,
    'icon_512x512.png': 512,
    'icon_512x512@2x.png': 1024,
}


def squircle_mask(size: int) -> Image.Image:
    """Apple 风格超圆角（squircle）蒙版。

    连续曲率矩形近似：矩形内满足
    (|x/a|^n + |y/b|^n)^(1/n) <= 1 的超椭圆，n≈5 视觉最接近 Apple
    模板（n=2 是普通椭圆，n=∞ 是矩形，n=4~5 是 iOS/macOS 圆角观感）。
    """
    n = 5.0
    a = size / 2
    b = size / 2
    mask = Image.new('L', (size, size), 0)
    px = mask.load()
    for y in range(size):
        ny = (y + 0.5 - a) / b
        for x in range(size):
            nx = (x + 0.5 - a) / b
            inside = (abs(nx) ** n + abs(ny) ** n) ** (1 / n) <= 1
            if inside:
                px[x, y] = 255
    return mask


def main() -> None:
    src = Image.open(SRC).convert('RGB')
    assert src.size == (1024, 1024), f'原图应为 1024×1024，实际 {src.size}'

    # 内容区：原图缩到 824，居中贴到透明画布
    content = src.resize((CONTENT, CONTENT), Image.LANCZOS)
    icon = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    icon.paste(content, (MARGIN, MARGIN))
    # squircle 蒙版只作用于内容区（画布其余本就透明）
    mask = squircle_mask(CONTENT)
    full_mask = Image.new('L', (CANVAS, CANVAS), 0)
    full_mask.paste(mask, (MARGIN, MARGIN))
    icon.putalpha(full_mask)

    out_png = ROOT / 'build' / 'icon.png'
    out_png.parent.mkdir(exist_ok=True)
    icon.save(out_png)

    # iconset → icns（系统 iconutil）
    with tempfile.TemporaryDirectory() as td:
        iconset = Path(td) / 'icon.iconset'
        iconset.mkdir()
        for name, size in ICONS.items():
            icon.resize((size, size), Image.LANCZOS).save(iconset / name)
        subprocess.run(
            ['iconutil', '-c', 'icns', str(iconset), '-o', str(ROOT / 'build' / 'icon.icns')],
            check=True,
        )

    print(f'build/icon.png  {CANVAS}px squircle r≈{RADIUS}')
    print('build/icon.icns 全档位已生成')


if __name__ == '__main__':
    main()
