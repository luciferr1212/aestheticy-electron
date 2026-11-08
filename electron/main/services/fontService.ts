import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDataDir } from '../dataDir.ts';
import type { UserFont } from '../../../src/shared/ipcTypes.ts';

const ALLOWED_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const MAX_BYTES = 30 * 1024 * 1024;

/**
 * Stores fonts the user adds (Settings > Theme > Font) in <data>/fonts. Each file is saved as
 * "<id>__<original name>" so the list can be rebuilt from the folder alone.
 */
class FontService {
  private dir(): string {
    const d = path.join(getDataDir(), 'fonts');
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
  }

  private toUserFont(fileName: string): UserFont | null {
    const m = fileName.match(/^([a-f0-9]{8})__(.+)$/);
    if (!m) return null;
    const ext = path.extname(m[2]).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return null;
    let size = 0;
    try {
      size = fs.statSync(path.join(this.dir(), fileName)).size;
    } catch {
      return null;
    }
    const base = path.basename(m[2], ext).replace(/[_]+/g, ' ').trim();
    return { id: m[1], name: base || 'Custom font', fileName: m[2], size };
  }

  public list(): UserFont[] {
    try {
      return fs
        .readdirSync(this.dir())
        .map((f) => this.toUserFont(f))
        .filter((f): f is UserFont => f !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  private findFile(id: string): string | null {
    if (!/^[a-f0-9]{8}$/.test(id)) return null;
    try {
      const hit = fs.readdirSync(this.dir()).find((f) => f.startsWith(`${id}__`));
      return hit ? path.join(this.dir(), hit) : null;
    } catch {
      return null;
    }
  }

  public save(fileName: string, dataBase64: string): UserFont {
    const ext = path.extname(fileName).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      throw new Error('Unsupported font type. Use .ttf, .otf, .woff or .woff2');
    }
    const buf = Buffer.from(dataBase64, 'base64');
    if (buf.length < 256) throw new Error('That file is too small to be a font');
    if (buf.length > MAX_BYTES) throw new Error('Font file is larger than 30 MB');
    const safe = path
      .basename(fileName, ext)
      .replace(/[^\p{L}\p{N} _.-]+/gu, '')
      .trim()
      .slice(0, 80) || 'font';
    const id = crypto.randomBytes(4).toString('hex');
    const stored = `${id}__${safe}${ext}`;
    fs.writeFileSync(path.join(this.dir(), stored), buf);
    const font = this.toUserFont(stored);
    if (!font) throw new Error('Could not store the font');
    return font;
  }

  public getData(id: string): string | null {
    const file = this.findFile(id);
    if (!file) return null;
    try {
      return fs.readFileSync(file).toString('base64');
    } catch {
      return null;
    }
  }

  public remove(id: string): void {
    const file = this.findFile(id);
    if (file) {
      try {
        fs.unlinkSync(file);
      } catch {
        // ignore
      }
    }
  }
}

export const fontService = new FontService();
