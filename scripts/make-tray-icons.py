#!/usr/bin/env python3
"""从自有品牌 app 图标（assets/icon.png，黑底 + 蓝色 K）派生托盘图。

纯像素处理（keying/裁剪/缩放），零设计：
1. 背景色 keying：以左上角背景色为基准，颜色距离 ≤30 全透明、
   ≥90 全不透明、中间线性过渡（实测该图标双峰分离，中间无像素）；
2. 裁剪：K 形状包围盒（约 x[312,684] y[330,692]）外扩 20px 取正方形；
3. area 缩放到 32px（box filter，预乘 alpha 加权）。

产物：
- assets/tray.png         32px 彩色（品牌蓝 K，Win/Linux 托盘）
- assets/trayTemplate.png 32px 纯黑 + alpha（macOS Template 图，
  深浅菜单栏自动反色；menu.ts 已按平台加载）
- assets/brand-k.png      64px 彩色透明底（brand-injector 注入上游
  侧边栏 logo 用；大尺寸保证 retina 清晰）

用法：python3 scripts/make-tray-icons.py
注意：pnpm icons（make-icons.cjs 产上游鲸鱼图）会覆盖本产物，需重跑本脚本。
无第三方依赖（手写 PNG 解码/编码）。
"""

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'icon.png'
OUT_SIZE = 32
BRAND_SIZE = 64  # 侧边栏 logo 源（24px 显示 × retina 富余）
# K 形状包围盒（step2 全画布扫描得到；换 logo 源图后需重测）
BBOX = (312, 330, 684, 692)  # x0, y0, x1, y1（含端点）
PAD = 20


def decode(path):
    d = path.read_bytes()
    pos = 8
    idat = b''
    w = h = ct = None
    while pos < len(d):
        ln, typ = struct.unpack('>I4s', d[pos:pos + 8])
        pos += 8
        if typ == b'IHDR':
            w, h, _, ct = struct.unpack('>IIBB', d[pos:pos + 10])
        elif typ == b'IDAT':
            idat += d[pos:pos + ln]
        elif typ == b'IEND':
            break
        pos += ln + 4
    raw = zlib.decompress(idat)
    if ct != 2:  # 仅 RGB
        raise SystemExit(f'预期 RGB(colortype 2) 源图，实际 colortype {ct}')
    stride = w * 3
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for _ in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if f == 1:
            for i in range(3, stride):
                line[i] = (line[i] + line[i - 3]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - 3] if i >= 3 else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - 3] if i >= 3 else 0
                b = prev[i]
                c = prev[i - 3] if i >= 3 else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out += line
        prev = line
    return w, h, bytes(out)


def encode_rgba(w, h, rgba):
    def chunk(typ, data):
        return (struct.pack('>I', len(data)) + typ + data
                + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff))

    raw = b''.join(b'\x00' + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


def area_resize(rgba, w, h, wx, wy, side, out_size):
    """从 w×h 的 RGBA 源裁剪窗口 (wx,wy)+side，area 缩放到 out_size 正方形。"""
    out = bytearray(out_size * out_size * 4)
    scale = side / out_size
    for ty in range(out_size):
        sy0, sy1 = ty * scale, (ty + 1) * scale
        for tx in range(out_size):
            sx0, sx1 = tx * scale, (tx + 1) * scale
            rs = gs = bs = asum = wsum = 0.0
            for sy in range(int(sy0), int(sy1) + 1):
                wygt = min(sy + 1, sy1) - max(sy, sy0)
                if wygt <= 0:
                    continue
                for sx in range(int(sx0), int(sx1) + 1):
                    wxgt = min(sx + 1, sx1) - max(sx, sx0)
                    if wxgt <= 0:
                        continue
                    j = ((wy + sy) * w + (wx + sx)) * 4
                    a = rgba[j + 3] / 255.0
                    wt = wxgt * wygt
                    rs += rgba[j] * a * wt
                    gs += rgba[j + 1] * a * wt
                    bs += rgba[j + 2] * a * wt
                    asum += a * wt
                    wsum += wt
            j = (ty * out_size + tx) * 4
            if wsum > 0 and asum > 0:
                out[j] = min(255, int(rs / asum + 0.5))
                out[j + 1] = min(255, int(gs / asum + 0.5))
                out[j + 2] = min(255, int(bs / asum + 0.5))
                out[j + 3] = min(255, int(asum / wsum * 255 + 0.5))
    return out


def main():
    w, h, px = decode(SRC)
    # 背景色取左上角（实测全边缘一致）
    bg = (px[0], px[1], px[2])
    t0, t1 = 30.0, 90.0

    # 1. keying → RGBA
    rgba = bytearray(w * h * 4)
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * 3
            j = (y * w + x) * 4
            r, g, b = px[i], px[i + 1], px[i + 2]
            d = ((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2) ** 0.5
            a = 0 if d <= t0 else 255 if d >= t1 else int((d - t0) / (t1 - t0) * 255)
            rgba[j], rgba[j + 1], rgba[j + 2], rgba[j + 3] = r, g, b, a

    # 2. 包围盒外扩 → 正方形窗口
    x0, y0, x1, y1 = BBOX
    side = max(x1 - x0, y1 - y0) + 1 + PAD * 2
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    wx, wy = cx - side // 2, cy - side // 2
    if wx < 0 or wy < 0 or wx + side > w or wy + side > h:
        raise SystemExit(f'裁剪窗口越界: ({wx},{wy})+{side}，画布 {w}x{h}（重测 BBOX？）')

    # 3. area 缩放（box filter，预乘 alpha 加权）
    out = area_resize(rgba, w, h, wx, wy, side, OUT_SIZE)

    (ROOT / 'assets' / 'tray.png').write_bytes(encode_rgba(OUT_SIZE, OUT_SIZE, out))

    # 3b. 侧边栏 logo 源：同窗口 64px 彩色透明版（brand-injector 用）
    brand = area_resize(rgba, w, h, wx, wy, side, BRAND_SIZE)
    (ROOT / 'assets' / 'brand-k.png').write_bytes(encode_rgba(BRAND_SIZE, BRAND_SIZE, brand))

    # 4. Template 版：同 alpha mask，RGB 纯黑（macOS 自动反色）
    tmpl = bytearray(OUT_SIZE * OUT_SIZE * 4)
    for i in range(OUT_SIZE * OUT_SIZE):
        j = i * 4
        tmpl[j], tmpl[j + 1], tmpl[j + 2], tmpl[j + 3] = 0, 0, 0, out[j + 3]
    (ROOT / 'assets' / 'trayTemplate.png').write_bytes(encode_rgba(OUT_SIZE, OUT_SIZE, tmpl))

    opaque = sum(1 for i in range(OUT_SIZE * OUT_SIZE) if out[i * 4 + 3] > 128)
    print(f'托盘图已派生（源 {SRC.name}，背景 rgb{bg}）：'
          f'assets/tray.png + trayTemplate.png（32px，不透明 {opaque / (OUT_SIZE * OUT_SIZE):.0%}）'
          f' + brand-k.png（{BRAND_SIZE}px）')


if __name__ == '__main__':
    main()
