import { create } from 'zustand';

interface UIStore {
  sidebarOpen: boolean;
  settingsOpen: boolean;
  newSessionOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setNewSessionOpen: (open: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  settingsOpen: false,
  newSessionOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setNewSessionOpen: (open) => set({ newSessionOpen: open }),
}));
