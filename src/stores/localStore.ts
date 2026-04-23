import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Local = 'ambos' | 'vedia' | 'saavedra';

interface LocalStore {
  local: Local;
  setLocal: (l: Local) => void;
}

export const useLocalStore = create<LocalStore>()(
  persist(
    (set) => ({
      local: 'ambos',
      setLocal: (local) => set({ local }),
    }),
    { name: 'rodziny-local' },
  ),
);
