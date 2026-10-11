import * as fs from 'fs';
import * as path from 'path';
import { Request, Response, NextFunction } from 'express';
import { storageRoot } from '../utils/storage';

// Last-resort handler for GET /storage/<path>.
//
// Every image column in the HMS database still points at the pre-migration file
// names (`facility/Room-1751560911.jpeg`, `content-banner/banner/KUA3...jpg`, ...)
// but none of those files exist on this machine any more, nor on the production
// host — an audit of Postgres `properties.logo`, `content_banners.image`,
// `content_room_images.image`, `content_room_facilities.image` plus a HEAD probe of
// https://rndhms.dipstrategy.co.id/storage/... came back empty/404 across the board.
//
// Rather than leaving the guest-facing booking engine with a wall of broken images
// (and the HMS grids showing empty tiles), an unmatched image request is answered
// with a generated SVG built from the path itself: the folder decides the palette
// and the motif, the filename decides the caption. It is deterministic, cacheable
// and needs no database rewrite, so re-uploading a real photo through the HMS UI
// automatically shadows it again (express.static runs first).

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

interface Palette {
  from: string;
  to: string;
  ink: string;
  accent: string;
}

// One palette per storage folder so the generated art stays consistent with what
// that folder means, instead of randomising hue per file.
const CATEGORY_PALETTE: Record<string, Palette> = {
  facility: { from: '#0f3b5c', to: '#1d6a8f', ink: '#eaf6fb', accent: '#7fd4f0' },
  'image-room-type': { from: '#241a4d', to: '#4b3a8f', ink: '#efeaff', accent: '#b9a4ff' },
  'content-banner': { from: '#05304f', to: '#065299', ink: '#e8f2fb', accent: '#6fc0f0' },
  property: { from: '#0b3b39', to: '#11695f', ink: '#e6fbf6', accent: '#79dcc9' },
  'rate-config': { from: '#4a2c06', to: '#8a5410', ink: '#fdf3e3', accent: '#f0c078' },
  types: { from: '#2b2f36', to: '#454b55', ink: '#eef0f3', accent: '#aab3bf' },
};

const DEFAULT_PALETTE: Palette = { from: '#1f2933', to: '#3e4c59', ink: '#eef2f7', accent: '#9fb3c8' };

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// "Room-1751560911.jpeg" -> "Room"; "Air-Conditioning-1751560022.png" ->
// "Air Conditioning". Keeps the caption honest about what the row was named.
function captionFromFilename(file: string): string {
  const base = file.replace(IMAGE_EXT, '');
  const withoutStamp = base.replace(/[-_](\d{9,13})$/, '');
  const words = withoutStamp.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return 'Image';
  return words
    .split(' ')
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function categoryFromPath(relPath: string): string {
  const first = relPath.split('/')[0] || '';
  return first.toLowerCase();
}

// Intentionally plain: a flat field, one inset hairline frame and a centred caption.
// The caption sits on the exact middle of the canvas because the consumers crop with
// `object-cover` (portrait room cards, wide hero strips) — only the centre survives
// every crop, so anything pinned to an edge gets cut off.

function buildSvg(relPath: string, wide: boolean): string {
  const category = categoryFromPath(relPath);
  const palette = CATEGORY_PALETTE[category] ?? DEFAULT_PALETTE;
  const file = relPath.split('/').pop() ?? '';
  const caption = captionFromFilename(file).toUpperCase();
  const w = wide ? 1200 : 800;
  const h = wide ? 520 : 600;
  const cx = w / 2;
  const cy = h / 2;
  // Keep the caption inside the central third even for long names.
  const maxWidth = w * 0.3;
  const fontSize = Math.max(14, Math.min(wide ? 34 : 30, Math.floor(maxWidth / (caption.length * 0.62))));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeXml(caption)}">
  <rect width="${w}" height="${h}" fill="${palette.from}"/>
  <rect x="${cx - maxWidth / 2 - 24}" y="${cy - 56}" width="${maxWidth + 48}" height="112" fill="none" stroke="${palette.accent}" stroke-opacity="0.45" stroke-width="1.5"/>
  <text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="${palette.ink}" fill-opacity="0.92"
        font-family="'Segoe UI',system-ui,-apple-system,sans-serif" font-size="${fontSize}"
        font-weight="600" letter-spacing="1.5">${escapeXml(caption)}</text>
  <text x="${cx}" y="${cy + 34}" text-anchor="middle" fill="${palette.ink}" fill-opacity="0.55"
        font-family="'Segoe UI',system-ui,-apple-system,sans-serif" font-size="12"
        letter-spacing="3">${escapeXml(category.replace(/-/g, ' ').toUpperCase())}</text>
</svg>`;
}

/**
 * Express middleware. Mount it AFTER `express.static(storageRoot())` so real files
 * always win; only requests that fell through reach here.
 */
export function storageFallback(_req: Request, res: Response, next: NextFunction): void {
  // express.static already answered or moved on; anything reaching this point with a
  // non-image path belongs to the normal 404 flow.
  if (res.headersSent) {
    next();
    return;
  }

  const url = _req.path || '';
  if (!IMAGE_EXT.test(url)) {
    next();
    return;
  }

  const relPath = decodeURIComponent(url.replace(/^\/+/, ''));
  const root = path.resolve(storageRoot());
  const onDisk = path.resolve(root, relPath);

  // Only synthesise when the file genuinely is missing, and never for a path that
  // tries to escape the storage root.
  if (onDisk.startsWith(root + path.sep) && fs.existsSync(onDisk)) {
    next();
    return;
  }

  const category = categoryFromPath(relPath);
  const wide = category === 'content-banner' || category === 'property';
  const svg = buildSvg(relPath, wide);

  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-HMS-Placeholder', '1');
  res.status(200).send(svg);
}