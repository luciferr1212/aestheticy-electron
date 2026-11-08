import React, { useState, useRef } from 'react';
import { FolderPlus, Upload, Folder, Check, X, Loader2 } from 'lucide-react';
import type { MusicFolder } from '../shared/ipcTypes.ts';
import { ipcClient, isElectronDesktop } from '../services/ipcClient.ts';

interface AddFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingFolders: MusicFolder[];
  availableServerFolders: { name: string; path: string; description: string }[];
  onFolderAdded: () => Promise<void>;
}

export const AddFolderModal: React.FC<AddFolderModalProps> = ({
  isOpen,
  onClose,
  existingFolders,
  availableServerFolders,
  onFolderAdded,
}) => {
  const [customPath, setCustomPath] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const existingPaths = new Set(existingFolders.map((f) => f.path));

  const handleNativeElectronPicker = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const res = await ipcClient.selectAndAddFolder();
      if (res.added) {
        await onFolderAdded();
        onClose();
      } else if (res.error) {
        setErrorMessage(res.error);
      }
    } catch {
      setErrorMessage(
        'We could not open the folder picker right now. Please make sure the folder exists and try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddServerFolder = async (folderPath: string) => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const res = await ipcClient.addFolderByPath(folderPath);
      if (res.added) {
        await onFolderAdded();
        onClose();
      } else {
        setErrorMessage(
          res.error ||
            'We could not find that folder on your computer. Please check the folder path and try again.'
        );
      }
    } catch {
      setErrorMessage(
        'We could not reach that folder right now. Please verify the path exists and that Aestheticy has permission to read it.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCustomPathSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPath.trim()) return;
    await handleAddServerFolder(customPath.trim());
  };

  const handleBrowserDirectoryPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const firstRelPath = (files[0] as any).webkitRelativePath || '';
      const folderName = firstRelPath.split(/[\\/]/)[0] || 'My Local Music';

      const res = await ipcClient.uploadBrowserFolderFiles(folderName, files);
      if (res.added) {
        await onFolderAdded();
        onClose();
      } else {
        setErrorMessage(
          res.error ||
            'No supported music files were found in the selected folder. Try choosing a folder with MP3, FLAC, WAV, ALAC, or M4A songs.'
        );
      }
    } catch {
      setErrorMessage(
        'We could not import all files from that folder. Please check that the files are not corrupted or on a disconnected drive.'
      );
    } finally {
      setIsSubmitting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-xl bg-[#11131C] border border-[#24293D] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E2230]">
          <div className="flex items-center gap-2.5">
            <FolderPlus size={18} className="text-[#818CF8]" />
            <h2 className="text-base font-semibold text-[#F3F4F6]">Add Music Folder</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#8E95A9] hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <p className="text-xs text-[#9CA3AF] leading-relaxed">
            Aestheticy recursively scans folders for{' '}
            <span className="font-mono text-[#E5E7EB]">
              mp3 · flac · wav · ogg · opus · m4a · aac · alac · wma · ape · wv · aiff · aif · dsf · dff
            </span>
            , extracts ID3/Vorbis tags with FFprobe/FFmpeg fallback, caches embedded cover art to disk, and watches for live file changes.
          </p>

          {/* Option 1: Pick folder from User's Computer */}
          <div>
            <label className="block text-xs font-medium text-[#E5E7EB] mb-2">
              Select Folder from Your Computer
            </label>
            {isElectronDesktop() ? (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleNativeElectronPicker}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[#6366F1] hover:bg-[#818CF8] disabled:opacity-50 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <FolderPlus size={15} />}
                <span>Browse Windows Directory...</span>
              </button>
            ) : (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  {...({ webkitdirectory: '', directory: '' } as any)}
                  onChange={handleBrowserDirectoryPick}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[#6366F1] hover:bg-[#818CF8] disabled:opacity-50 text-xs font-semibold text-white transition-colors cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      <span>Scanning & Indexing Audio Files...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={15} />
                      <span>Choose Local Music Folder from Device...</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Option 2: Available Local Disk Directories */}
          {availableServerFolders.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[#E5E7EB] mb-2">
                Available Local Disk Directories
              </label>
              <div className="space-y-2">
                {availableServerFolders.map((dir) => {
                  const isAdded = existingPaths.has(dir.path);
                  return (
                    <div
                      key={dir.path}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#090A0F] border border-[#1E2230]"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <Folder size={16} className="text-[#818CF8] shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#F3F4F6] truncate">
                            {dir.name}
                          </div>
                          <div className="text-[11px] text-[#8E95A9] truncate mt-0.5">
                            {dir.description}
                          </div>
                        </div>
                      </div>
                      {isAdded ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 whitespace-nowrap shrink-0">
                          <Check size={13} />
                          <span>Watching</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => handleAddServerFolder(dir.path)}
                          className="px-3 py-1.5 rounded-md bg-[#1A1D2B] hover:bg-[#252A3E] border border-[#2D334A] text-xs font-medium text-[#F3F4F6] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Add Folder
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Option 3: Direct Path Input */}
          <form onSubmit={handleCustomPathSubmit} className="pt-2 border-t border-[#1E2230]">
            <label className="block text-xs font-medium text-[#8E95A9] mb-1.5">
              Or Add by Local File System Path
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="e.g., C:\Users\You\Music or /Users/you/Music"
                className="flex-1 px-3 py-2 rounded-lg bg-[#090A0F] border border-[#1E2230] focus:border-[#6366F1] focus:outline-none text-xs text-[#F3F4F6] placeholder-[#6B7280] font-mono"
              />
              <button
                type="submit"
                disabled={isSubmitting || !customPath.trim()}
                className="px-3.5 py-2 rounded-lg bg-[#1A1D2B] hover:bg-[#252A3E] border border-[#2D334A] disabled:opacity-40 text-xs font-medium text-[#F3F4F6] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Scan Path
              </button>
            </div>
          </form>

          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
