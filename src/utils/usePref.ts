import { useCallback, useState } from 'react';
import { loadPref, savePref } from './libraryPrefs.ts';

/** useState that persists a string-literal union in localStorage (per-viewer UI convenience). */
export function usePref<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => loadPref<T>(key, allowed, fallback));
  const update = useCallback(
    (next: T) => {
      setValue(next);
      savePref(key, next);
    },
    [key]
  );
  return [value, update];
}
