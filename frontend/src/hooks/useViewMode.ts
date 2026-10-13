import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ViewMode = 'grid' | 'list';

/**
 * Persists a grid/list toggle preference in AsyncStorage.
 * Returns [currentMode, toggleFn].
 */
export function useViewMode(storageKey: string, defaultMode: ViewMode): [ViewMode, () => void] {
  const [mode, setMode] = useState<ViewMode>(defaultMode);

  useEffect(() => {
    AsyncStorage.getItem(storageKey).then(val => {
      if (val === 'grid' || val === 'list') setMode(val);
    });
  }, [storageKey]);

  const toggle = () => {
    setMode(prev => {
      const next: ViewMode = prev === 'grid' ? 'list' : 'grid';
      AsyncStorage.setItem(storageKey, next);
      return next;
    });
  };

  return [mode, toggle];
}
