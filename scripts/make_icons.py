#!/usr/bin/env python3
"""Draw 180x180 home-screen PNGs with the standard library only."""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

SIZE = 180
RADIUS = 40


def png_rgba(width: int, height: int, pixels: bytearray) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    raw = bytearray()
    row_bytes = width * 4
    for y in range(height):
        raw.append(0)
        start = y * row_bytes
        raw.extend(pixels[start : start + row_bytes])
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(
        b"IDAT", zlib.compress(bytes(raw), 9)
    ) + chunk(b"IEND", b"")


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def rounded_rect_mask(size: int, radius: int) -> list[float]:
    mask = [0.0] * (size * size)
    r = radius
    for y in range(size):
        for x in range(size):
            inside = True
            cx = cy = 0
            if x < r and y < r:
                cx, cy = x - r, y - r
            elif x >= size - r and y < r:
                cx, cy = x - (size - 1 - r), y - r
            elif x < r and y >= size - r:
                cx, cy = x - r, y - (size - 1 - r)
            elif x >= size - r and y >= size - r:
                cx, cy = x - (size - 1 - r), y - (size - 1 - r)
            else:
                mask[y * size + x] = 1.0
                continue
            dist = math.sqrt(cx * cx + cy * cy)
            if dist <= r - 0.5:
                mask[y * size + x] = 1.0
            elif dist < r + 0.5:
                mask[y * size + x] = max(0.0, r + 0.5 - dist)
            else:
                mask[y * size + x] = 0.0 if inside else 0.0
    return mask


MASK = rounded_rect_mask(SIZE, RADIUS)


def fill(color: tuple[int, int, int]) -> bytearray:
    pixels = bytearray(SIZE * SIZE * 4)
    r, g, b = color
    for i, a in enumerate(MASK):
        o = i * 4
        pixels[o] = r
        pixels[o + 1] = g
        pixels[o + 2] = b
        pixels[o + 3] = int(255 * a)
    return pixels


def set_pixel(pixels: bytearray, x: int, y: int, color: tuple[int, int, int], alpha: float = 1.0) -> None:
    if x < 0 or y < 0 or x >= SIZE or y >= SIZE:
        return
    i = y * SIZE + x
    o = i * 4
    base_a = MASK[i]
    a = base_a * alpha
    if a <= 0:
        return
    pixels[o] = color[0]
    pixels[o + 1] = color[1]
    pixels[o + 2] = color[2]
    pixels[o + 3] = int(255 * a)


def fill_poly(pixels: bytearray, points: list[tuple[float, float]], color: tuple[int, int, int]) -> None:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    minx, maxx = int(min(xs)), int(max(xs)) + 1
    miny, maxy = int(min(ys)), int(max(ys)) + 1
    n = len(points)
    for y in range(miny, maxy + 1):
        for x in range(minx, maxx + 1):
            inside = False
            j = n - 1
            for i in range(n):
                xi, yi = points[i]
                xj, yj = points[j]
                if ((yi > y) != (yj > y)) and (
                    x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-6) + xi
                ):
                    inside = not inside
                j = i
            if inside:
                set_pixel(pixels, x, y, color)


def fill_circle(pixels: bytearray, cx: float, cy: float, radius: float, color: tuple[int, int, int], ring: float = 0.0) -> None:
    r2_outer = radius * radius
    r2_inner = (radius - ring) * (radius - ring) if ring else -1
    xmin = int(cx - radius) - 1
    xmax = int(cx + radius) + 1
    ymin = int(cy - radius) - 1
    ymax = int(cy + radius) + 1
    for y in range(ymin, ymax + 1):
        for x in range(xmin, xmax + 1):
            d2 = (x - cx) ** 2 + (y - cy) ** 2
            if d2 <= r2_outer and d2 >= r2_inner:
                set_pixel(pixels, x, y, color)


def fill_rect(pixels: bytearray, x0: int, y0: int, x1: int, y1: int, color: tuple[int, int, int]) -> None:
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            set_pixel(pixels, x, y, color)


def save(name: str, pixels: bytearray, out_dir: Path) -> None:
    path = out_dir / name
    path.write_bytes(png_rgba(SIZE, SIZE, pixels))


def icon_youtube() -> bytearray:
    pixels = fill((204, 0, 0))
    fill_poly(
        pixels,
        [(72, 55), (72, 125), (128, 90)],
        (255, 255, 255),
    )
    return pixels


def icon_whatsapp() -> bytearray:
    pixels = fill((37, 211, 102))
    fill_circle(pixels, 96, 86, 48, (255, 255, 255), ring=10)
    fill_poly(
        pixels,
        [(58, 128), (70, 108), (88, 118)],
        (255, 255, 255),
    )
    return pixels


def icon_launcher() -> bytearray:
    pixels = fill((0, 122, 255))
    # 3x3 dots
    for row in range(3):
        for col in range(3):
            fill_circle(pixels, 54 + col * 36, 54 + row * 36, 10, (255, 255, 255))
    return pixels


def icon_gmail() -> bytearray:
    pixels = fill((234, 67, 53))
    fill_poly(
        pixels,
        [(36, 58), (90, 102), (144, 58), (144, 128), (36, 128)],
        (255, 255, 255),
    )
    fill_poly(
        pixels,
        [(48, 70), (90, 104), (132, 70), (132, 118), (48, 118)],
        (234, 67, 53),
    )
    return pixels


def icon_maps() -> bytearray:
    pixels = fill((52, 168, 83))
    fill_circle(pixels, 90, 78, 38, (255, 255, 255))
    fill_circle(pixels, 90, 78, 16, (52, 168, 83))
    fill_poly(pixels, [(90, 148), (64, 104), (116, 104)], (255, 255, 255))
    return pixels


def icon_news() -> bytearray:
    pixels = fill((30, 30, 30))
    fill_rect(pixels, 40, 42, 140, 58, (255, 209, 0))
    fill_rect(pixels, 40, 72, 140, 82, (255, 255, 255))
    fill_rect(pixels, 40, 92, 140, 102, (255, 255, 255))
    fill_rect(pixels, 40, 112, 110, 122, (255, 255, 255))
    fill_rect(pixels, 40, 132, 90, 142, (255, 255, 255))
    return pixels


def icon_weather() -> bytearray:
    pixels = fill((0, 51, 102))
    fill_circle(pixels, 70, 72, 28, (255, 196, 0))
    fill_circle(pixels, 108, 92, 30, (255, 255, 255))
    fill_circle(pixels, 82, 100, 24, (255, 255, 255))
    fill_circle(pixels, 128, 100, 22, (255, 255, 255))
    fill_rect(pixels, 78, 100, 130, 122, (255, 255, 255))
    return pixels


def main() -> None:
    out = Path(__file__).resolve().parents[1] / "apps" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    save("launcher.png", icon_launcher(), out)
    save("youtube.png", icon_youtube(), out)
    save("whatsapp.png", icon_whatsapp(), out)
    save("gmail.png", icon_gmail(), out)
    save("maps.png", icon_maps(), out)
    save("news.png", icon_news(), out)
    save("weather.png", icon_weather(), out)
    print("Wrote icons to", out)


if __name__ == "__main__":
    main()
