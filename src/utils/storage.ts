// Local-disk storage parity with Laravel's Storage::disk('public').
// Root: <STORAGE_PATH || ./storage> — served statically at /storage/*.
import * as fs from 'fs';
import * as path from 'path';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif'];
const DOC_EXTS = ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'];

export function storageRoot(): string {
  return process.env.STORAGE_PATH || path.join(process.cwd(), 'storage');
}

interface SaveResult { filePath: string; originalName: string | null }

// checkBase64() parity — data:image/<ext>;base64,... only.
export function saveBase64Image(dataUri: string, folder: string, prefix = 'image'): SaveResult | null {
  const m = typeof dataUri === 'string' ? dataUri.match(/^data:image\/(\w+);base64,(.*)$/) : null;
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (!IMAGE_EXTS.includes(ext)) return null;
  try {
    const buf = Buffer.from(m[2], 'base64');
    const dir = path.join(storageRoot(), folder);
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${prefix}_${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(dir, fileName), buf);
    return { filePath: `${folder}/${fileName}`, originalName: fileName };
  } catch {
    return null;
  }
}

// Property logo parity with Laravel PropertyController@store/@update:
// base64 data-URI -> STORAGE_PATH/property/<name>-<unix-ts>.<ext>, returns the
// '/'-prefixed relative path persisted in properties.logo (= Laravel's
// Storage::disk('public')->put('/property/...')). A non-data-URI payload
// means "logo unchanged" and yields null so callers keep the stored path.
export function savePropertyLogo(dataUri: unknown, name: unknown): string | null {
  const m = typeof dataUri === 'string' ? dataUri.match(/^data:image\/(\w+);base64,(.*)$/s) : null;
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (!IMAGE_EXTS.includes(ext)) return null;
  const base = String(name ?? 'property')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '') || 'property';
  try {
    const dir = path.join(storageRoot(), 'property');
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${base}-${Math.floor(Date.now() / 1000)}.${ext}`;
    fs.writeFileSync(path.join(dir, fileName), Buffer.from(m[2], 'base64'));
    return `/property/${fileName}`;
  } catch {
    return null;
  }
}

// Remove a previously stored logo. Only ever deletes inside storageRoot().
export function deleteStoredFile(relativePath: string | null | undefined): void {
  if (typeof relativePath !== 'string' || !relativePath) return;
  const root = path.resolve(storageRoot());
  const target = path.resolve(root, relativePath.replace(/^\/+/, ''));
  if (target !== root && !target.startsWith(root + path.sep)) return;
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch {
    // Best effort — a stale orphan file must never fail the request.
  }
}

// Absolute path for a stored relative path, or null when it escapes storageRoot().
export function resolveStoredPath(relativePath: string): string | null {
  if (!relativePath || /^data:/i.test(relativePath) || /^[a-z][a-z0-9+.-]*:\/\//i.test(relativePath)) return null;
  const root = path.resolve(storageRoot());
  const target = path.resolve(root, relativePath.replace(/^\/+/, ''));
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

// Content-Type from extension — property logos arrive as png/jpg/gif/webp.
export function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return map[ext] || 'application/octet-stream';
}

// True when a stored column holds a legacy raw base64/data-URI blob instead of
// a file path. Rows written by the pre-fix propertyUpdate still look like this,
// so every read path must screen for it before building a /storage URL.
export function isInlineImageData(value: unknown): boolean {
  return typeof value === 'string' && /^\s*data:image\//i.test(value);
}

// Public URL for a stored logo, or null when the column is not a usable path.
// A data-URI / absolute-URL column means the row predates the storage fix, so we
// refuse to build '/storage' + <base64> and let the caller use its fallback.
export function storedImageUrl(relativePath: unknown): string | null {
  if (typeof relativePath !== 'string') return null;
  const rel = relativePath.trim();
  if (!rel || isInlineImageData(rel) || /^[a-z][a-z0-9+.-]*:\/\//i.test(rel)) return null;
  const normalized = rel.startsWith('/') ? rel : `/${rel}`;
  return resolveStoredPath(normalized) ? `/storage${normalized}` : null;
}

// Multipart upload parity with Laravel `$request->file('image')->store($folder, 'public')`.
// The banner form posts the file as multipart/form-data (see components/pages/banner/form),
// so this is the only path that ever persists a content_banners.image. Returns the
// '/'-less relative path stored in the column, matching saveBase64Image().
export function saveUploadedImage(
  file: { originalname: string; mimetype: string; buffer: Buffer } | undefined | null,
  folder: string,
  maxSizeBytes = 2 * 1024 * 1024
): string | null {
  if (!file || !file.buffer || !file.buffer.length) return null;
  const ext = String(file.originalname || '').split('.').pop()?.toLowerCase() ?? '';
  if (!IMAGE_EXTS.includes(ext)) return null;
  if (file.buffer.length > maxSizeBytes) return null;
  try {
    const dir = path.join(storageRoot(), folder);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = Math.random().toString(36).slice(2, 10);
    const fileName = `${Date.now()}-${stamp}.${ext}`;
    fs.writeFileSync(path.join(dir, fileName), file.buffer);
    return `${folder}/${fileName}`;
  } catch {
    return null;
  }
}

// Guest documents accept a broader mime set (= mimes:jpeg,png,jpg,pdf,doc,docx,xls,xlsx,ppt,pptx,txt).
// FE sends the file as a base64 data-URI in JSON; original name may ride along in `file_name`.
export function saveDocumentFromDataUri(dataUri: string, folder = 'guest-documents'): SaveResult | null {
  const m = typeof dataUri === 'string' ? dataUri.match(/^data:([\w+.-]+)\/([\w+.-]+);base64,(.*)$/) : null;
  if (!m) return null;
  let ext = m[2].toLowerCase();
  if (ext === 'plain') ext = 'txt';
  if (!DOC_EXTS.includes(ext)) return null;
  try {
    const buf = Buffer.from(m[3], 'base64');
    const dir = path.join(storageRoot(), folder);
    fs.mkdirSync(dir, { recursive: true });
    // Laravel store() hashes the name; keep a readable unique name instead
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    fs.writeFileSync(path.join(dir, fileName), buf);
    return { filePath: `${folder}/${fileName}`, originalName: fileName };
  } catch {
    return null;
  }
}
