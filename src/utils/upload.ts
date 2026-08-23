// Shared multer factory — mirrors Laravel `mimes:...|max:2048` validation.
// Extension whitelist + mimetype family check (Laravel validates guessed ext
// from content; we accept either a matching declared mimetype or unknown).
import multer from 'multer';
import { Request } from 'express';

const MIME_BY_EXT: Record<string, string[]> = {
  jpeg: ['image/jpeg'],
  jpg: ['image/jpeg'],
  png: ['image/png'],
  gif: ['image/gif'],
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt: ['application/vnd.ms-powerpoint'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  txt: ['text/plain'],
};

export function makeUpload(allowedExts: string[], maxSizeMb = 2) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
      const ext = String(file.originalname).split('.').pop()?.toLowerCase() ?? '';
      if (!allowedExts.includes(ext)) {
        cb(new Error(`The ${file.fieldname} field must be a file of type: ${allowedExts.join(', ')}.`));
        return;
      }
      const accepted = MIME_BY_EXT[ext] ?? [];
      // If the client declares a mimetype we know is wrong for the extension, reject.
      if (file.mimetype && accepted.length > 0 && !accepted.includes(file.mimetype)) {
        // Some browsers/OS send generic mimetypes — allow octet-stream fallback.
        if (file.mimetype !== 'application/octet-stream') {
          cb(new Error(`The ${file.fieldname} field must be a file of type: ${allowedExts.join(', ')}.`));
          return;
        }
      }
      cb(null, true);
    },
  });
}
