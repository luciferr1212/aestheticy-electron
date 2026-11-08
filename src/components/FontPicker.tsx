import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Plus, Trash2, Type } from 'lucide-react';
import type { UserFont } from '../shared/ipcTypes.ts';
import { ipcClient } from '../services/ipcClient.ts';
import {
  FONT_PRESETS,
  fileToBase64,
  isFontInstalled,
  registerUserFonts,
} from '../utils/userFonts.ts';

interface FontPickerProps {
  fontFamily: string;
  accentColor: string;
  onChangeFontFamily: (family: string) => void;
}

export const FontPicker: React.FC<FontPickerProps> = ({
  fontFamily,
  accentColor,
  onChangeFontFamily,
}) => {
  const [userFonts, setUserFonts] = useState<UserFont[]>([]);
  const [customName, setCustomName] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await ipcClient.listUserFonts();
      setUserFonts(list);
      await registerUserFonts(list);
    } catch {
      setUserFonts([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setMessage(null);
    let last: UserFont | null = null;
    try {
      for (const file of Array.from(files)) {
        last = await ipcClient.saveUserFont(file.name, await fileToBase64(file));
      }
      await refresh();
      if (last) {
        onChangeFontFamily(last.name);
        setMessage({ ok: true, text: `Added "${last.name}" and applied it.` });
      }
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'Could not add that font.' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const applyCustom = () => {
    const name = customName.trim();
    if (!name) return;
    onChangeFontFamily(name);
    setMessage(
      isFontInstalled(name)
        ? { ok: true, text: `Using "${name}".` }
        : {
            ok: false,
            text: `"${name}" doesn't seem to be installed on this computer, so the app default is still shown. Install the font first, or add the font file instead.`,
          }
    );
  };

  const removeFont = async (font: UserFont) => {
    await ipcClient.deleteUserFont(font.id).catch(() => {});
    if (fontFamily === font.name) onChangeFontFamily('');
    // Fonts already registered stay in memory until restart; the list refreshes immediately.
    await refresh();
  };

  return (
    <div className="p-4 rounded-xl bg-black/30 border border-white/10 space-y-4">
      <div className="flex items-start gap-2.5">
        <Type size={15} style={{ color: accentColor }} className="mt-0.5 shrink-0" />
        <div>
          <h3 className="text-xs font-semibold text-white">Font</h3>
          <p className="text-xs text-white/60">
            Pick a font, type the name of any font installed on this PC, or add your own font file.
          </p>
        </div>
      </div>

      {/* Presets */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {FONT_PRESETS.map((preset) => {
          const active = fontFamily === preset.family;
          const installed = preset.family === '' || isFontInstalled(preset.family);
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChangeFontFamily(preset.family)}
              style={active ? { borderColor: accentColor } : undefined}
              className={`text-left p-2.5 rounded-xl border transition-colors cursor-pointer ${
                active ? 'bg-white/10' : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08]'
              }`}
            >
              <div
                className="text-sm text-white truncate"
                style={{ fontFamily: preset.family ? `"${preset.family}", sans-serif` : undefined }}
              >
                Aa — Liquid Glass
              </div>
              <div className="text-[11px] font-medium text-white/85 mt-1 truncate flex items-center gap-1">
                {active && <Check size={11} style={{ color: accentColor }} />}
                {preset.label}
              </div>
              <div className={`text-[10px] truncate ${installed ? 'text-white/45' : 'text-amber-300/80'}`}>
                {installed ? preset.hint : 'Not installed on this PC'}
              </div>
            </button>
          );
        })}
      </div>

      {/* User fonts */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-white/85">Your fonts</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="liquid-glass-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50 cursor-pointer"
          >
            <Plus size={13} />
            <span>{busy ? 'Adding…' : 'Add font file'}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".ttf,.otf,.woff,.woff2"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
        {userFonts.length === 0 ? (
          <p className="text-[11px] text-white/45">
            No custom fonts yet. Supported: .ttf, .otf, .woff, .woff2
          </p>
        ) : (
          <div className="space-y-1">
            {userFonts.map((font) => {
              const active = fontFamily === font.name;
              return (
                <div
                  key={font.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10"
                >
                  <button
                    type="button"
                    onClick={() => onChangeFontFamily(font.name)}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <span
                      className="block text-sm text-white truncate"
                      style={{ fontFamily: `"${font.name}", sans-serif` }}
                    >
                      {font.name} — Aa Bb 123 أبجد
                    </span>
                    <span className="block text-[10px] text-white/45 truncate">{font.fileName}</span>
                  </button>
                  {active && <Check size={14} style={{ color: accentColor }} />}
                  <button
                    type="button"
                    onClick={() => removeFont(font)}
                    title="Remove font"
                    className="p-1.5 rounded-lg text-white/55 hover:text-rose-300 hover:bg-white/10 cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Installed font by name */}
      <div className="space-y-1.5">
        <span className="text-xs font-semibold text-white/85">Use an installed font by name</span>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            applyCustom();
          }}
        >
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder='e.g. "SF Pro Display", "Tajawal", "Cairo"'
            className="flex-1 px-3 py-1.5 rounded-lg bg-black/35 border border-white/15 focus:border-white/40 focus:outline-none text-xs text-white placeholder-white/35"
          />
          <button
            type="submit"
            className="liquid-glass-btn px-3 py-1.5 rounded-lg text-xs font-medium text-white cursor-pointer"
          >
            Apply
          </button>
        </form>
      </div>

      {message && (
        <p className={`text-[11px] ${message.ok ? 'text-emerald-300/90' : 'text-amber-300/90'}`}>
          {message.text}
        </p>
      )}

      <p className="text-[11px] text-white/45 leading-relaxed">
        Want the exact Apple Music look? Download <span className="text-white/70">SF Pro</span> from
        Apple&apos;s font page (developer.apple.com/fonts), install the .otf files in Windows, then
        choose &ldquo;SF Pro (Apple Music)&rdquo;. Apple&apos;s license doesn&apos;t allow bundling SF Pro inside
        an app, which is why Aestheticy ships with Inter (a very close look-alike) by default.
      </p>
    </div>
  );
};
