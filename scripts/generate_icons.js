#!/usr/bin/env node
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Signed distance to a rounded rectangle with independent corner radii [tl, tr, br, bl]
function sdRoundedBox(px, py, x1, y1, x2, y2, rTL, rTR, rBR, rBL) {
	const cx = (x1 + x2) * 0.5;
	const cy = (y1 + y2) * 0.5;
	const hx = (x2 - x1) * 0.5;
	const hy = (y2 - y1) * 0.5;
	const dx = px - cx;
	const dy = py - cy;

	let r = rBR;
	if (dx < 0 && dy < 0) r = rTL;
	else if (dx >= 0 && dy < 0) r = rTR;
	else if (dx < 0 && dy >= 0) r = rBL;

	const qx = Math.abs(dx) - hx + r;
	const qy = Math.abs(dy) - hy + r;
	const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
	const inDist = Math.min(Math.max(qx, qy), 0);
	return outDist + inDist - r;
}

// Distance from point (px, py) to segment (ax, ay)-(bx, by)
function distToSegment(px, py, ax, ay, bx, by) {
	const vx = bx - ax;
	const vy = by - ay;
	const wx = px - ax;
	const wy = py - ay;
	const c1 = vx * wx + vy * wy;
	if (c1 <= 0) return Math.hypot(px - ax, py - ay);
	const c2 = vx * vx + vy * vy;
	if (c2 <= c1) return Math.hypot(px - bx, py - by);
	const b = c1 / c2;
	return Math.hypot(px - (ax + b * vx), py - (ay + b * vy));
}

function drawLedgerIcon(size) {
	const rowSize = 1 + size * 4;
	const rawData = Buffer.alloc(rowSize * size);

	function blendPx(x, y, r, g, b, alpha) {
		if (x < 0 || x >= size || y < 0 || y >= size || alpha <= 0) return;
		const offset = y * rowSize + 1 + x * 4;
		const fgA = Math.min(1, Math.max(0, alpha));
		const bgA = rawData[offset + 3] / 255;
		const outA = fgA + bgA * (1 - fgA);
		if (outA > 0) {
			rawData[offset] = Math.round((r * fgA + rawData[offset] * bgA * (1 - fgA)) / outA);
			rawData[offset + 1] = Math.round((g * fgA + rawData[offset + 1] * bgA * (1 - fgA)) / outA);
			rawData[offset + 2] = Math.round((b * fgA + rawData[offset + 2] * bgA * (1 - fgA)) / outA);
			rawData[offset + 3] = Math.round(outA * 255);
		}
	}

	const scale = size / 512;
	const aa = 1.0 / scale; // Anti-aliasing feather width in 512-space

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			// Map pixel center to 512x512 coordinate space
			const gx = (x + 0.5) / scale;
			const gy = (y + 0.5) / scale;

			// 1. App Icon Squircle Background (0..512, rx=112)
			const dBg = sdRoundedBox(gx, gy, 0, 0, 512, 512, 112, 112, 112, 112);
			if (dBg < aa) {
				const cov = Math.min(1, Math.max(0, 0.5 - dBg / aa));
				const t = (gx + gy) / 1024;
				// #f8fafc (248,250,252) -> #cbd5e1 (203,213,225)
				const r = Math.round(248 + (203 - 248) * t);
				const g = Math.round(250 + (213 - 250) * t);
				const b = Math.round(252 + (225 - 252) * t);
				blendPx(x, y, r, g, b, cov);
			}

			// 2. Soft Drop Shadow under Book (100..412, 72..416 shifted down by 14)
			const dShadow = sdRoundedBox(gx, gy - 14, 100, 72, 412, 416, 16, 24, 24, 24);
			if (dShadow < 22) {
				const sAlpha = Math.max(0, (1 - (dShadow + 10) / 32)) * 0.22;
				blendPx(x, y, 15, 23, 42, sAlpha);
			}

			// 3. Bookmark Ribbon (x: 236..280, y: 400..460, V-notch at bottom)
			if (gx >= 232 && gx <= 284 && gy >= 400 && gy <= 464) {
				const notchY = 442 + Math.abs(gx - 258) * (18 / 22);
				const inRibbonX = gx >= 236 && gx <= 280;
				const inRibbonY = gy <= notchY;
				const onBorder = (gx >= 232 && gx <= 284 && gy <= notchY + 5) && (!inRibbonX || gy >= notchY - 5);
				if (onBorder) {
					blendPx(x, y, 30, 41, 59, 1); // #1e293b border
				} else if (inRibbonX && inRibbonY) {
					blendPx(x, y, 244, 63, 94, 1); // #f43f5e fill
				}
			}

			// 4. Book Page Block / Bottom Thickness (x: 100..412, y: 320..416)
			// rTL=0, rTR=0 so it tucks cleanly under the front cover!
			const dPages = sdRoundedBox(gx, gy, 100, 320, 412, 416, 0, 0, 24, 24);
			if (dPages < aa) {
				const cov = Math.min(1, Math.max(0, 0.5 - dPages / aa));
				if (dPages > -10) {
					// Outer border #1e293b
					blendPx(x, y, 30, 41, 59, cov);
				} else {
					// Spine indent area vs white pages
					if (gx < 160) {
						blendPx(x, y, 203, 213, 225, cov); // #cbd5e1
					} else {
						blendPx(x, y, 255, 255, 255, cov); // #ffffff
						// Page horizontal lines at y=384 and y=398
						if (gx >= 176 && gx <= 388 && (Math.abs(gy - 384) <= 3 || (gx <= 376 && Math.abs(gy - 398) <= 3))) {
							blendPx(x, y, 148, 163, 184, cov); // #94a3b8
						}
					}
				}
			}

			// 5. Front Cover with "Yoseatsume" Patchwork (x: 100..412, y: 72..368)
			const dCover = sdRoundedBox(gx, gy, 100, 72, 412, 368, 16, 24, 24, 16);
			if (dCover < aa) {
				const cov = Math.min(1, Math.max(0, 0.5 - dCover / aa));
				if (dCover > -10) {
					// Cover outer border #1e293b
					blendPx(x, y, 30, 41, 59, cov);
				} else {
					// Default seam color #1e293b
					let cr = 30, cg = 41, cb = 59;

					if (gx <= 152) {
						// Book Spine (#1e3a8a)
						cr = 30; cg = 58; cb = 138;
						// Spine highlight
						if (gx >= 112 && gx <= 120) {
							cr = 53; cg = 96; cb = 178;
						}
						// Spine binding stitches at y = 128, 220, 312
						if (Math.abs(gy - 128) <= 3 || Math.abs(gy - 220) <= 3 || Math.abs(gy - 312) <= 3) {
							cr = 147; cg = 197; cb = 253; // #93c5fd
						}
					} else if (gx >= 160) {
						// Patchwork Tiles ("よせあつめ" Mosaic)
						if (gx <= 284 && gy <= 184) {
							// Tile 1: Top-Left Blue (#3b82f6)
							cr = 59; cg = 130; cb = 246;
						} else if (gx >= 292 && gy <= 156) {
							// Tile 2: Top-Right Amber Gold (#f59e0b)
							cr = 245; cg = 158; cb = 11;
						} else if (gx >= 292 && gy >= 164 && gy <= 274) {
							// Tile 3: Mid-Right Emerald Green (#10b981)
							cr = 16; cg = 185; cb = 129;
						} else if (gx <= 260 && gy >= 192) {
							// Tile 4: Bottom-Left Coral Rose (#f43f5e)
							cr = 244; cg = 63; cb = 94;
						} else if (gx >= 268 && gy >= 282) {
							// Tile 5: Bottom-Right Sky Cyan (#06b6d4)
							cr = 6; cg = 182; cb = 212;
						}
					}

					blendPx(x, y, cr, cg, cb, cov);
				}
			}

			// 6. Kakeibo Title Label (題箋ラベル: x: 224..344, y: 140..296, rx=16)
			const dLabel = sdRoundedBox(gx, gy, 224, 140, 344, 296, 16, 16, 16, 16);
			if (dLabel < aa) {
				const cov = Math.min(1, Math.max(0, 0.5 - dLabel / aa));
				if (dLabel > -10) {
					blendPx(x, y, 30, 41, 59, cov); // Border #1e293b
				} else {
					blendPx(x, y, 255, 255, 255, cov); // White label fill

					// Draw Yen Symbol '¥' inside Label
					const dArmL = distToSegment(gx, gy, 260, 176, 284, 212);
					const dArmR = distToSegment(gx, gy, 308, 176, 284, 212);
					const dStem = distToSegment(gx, gy, 284, 212, 284, 262);
					const dBar1 = distToSegment(gx, gy, 260, 222, 308, 222);
					const dBar2 = distToSegment(gx, gy, 260, 242, 308, 242);
					const dYen = Math.min(dArmL, dArmR, dStem, dBar1, dBar2) - 6.0;
					if (dYen < aa) {
						const yCov = Math.min(1, Math.max(0, 0.5 - dYen / aa));
						blendPx(x, y, 30, 41, 59, yCov);
					}
				}
			}
		}
	}

	return rawData;
}

function encodePng(width, height, rawData) {
	const compressed = zlib.deflateSync(rawData);
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

	const table = new Int32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) {
			c = (c & 1) ? -306674912 ^ (c >>> 1) : c >>> 1;
		}
		table[i] = c;
	}

	function crc32(buf) {
		let crc = -1;
		for (let i = 0; i < buf.length; i++) {
			crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
		}
		return crc ^ -1;
	}

	function makeChunk(type, data) {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length, 0);
		const typeBuf = Buffer.from(type, 'ascii');
		const crcBuf = Buffer.alloc(4);
		const crc = crc32(Buffer.concat([typeBuf, data]));
		crcBuf.writeInt32BE(crc, 0);
		return Buffer.concat([len, typeBuf, data, crcBuf]);
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;

	return Buffer.concat([
		signature,
		makeChunk('IHDR', ihdr),
		makeChunk('IDAT', compressed),
		makeChunk('IEND', Buffer.alloc(0))
	]);
}

const raw192 = drawLedgerIcon(192);
const png192 = encodePng(192, 192, raw192);
fs.writeFileSync(path.join(rootDir, 'icon-192.png'), png192);

const raw512 = drawLedgerIcon(512);
const png512 = encodePng(512, 512, raw512);
fs.writeFileSync(path.join(rootDir, 'icon-512.png'), png512);

console.log('Generated icon-192.png and icon-512.png');
