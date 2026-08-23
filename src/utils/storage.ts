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
