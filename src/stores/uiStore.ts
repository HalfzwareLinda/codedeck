import { create } from 'zustand';
import { PanelMode } from '../types';

interface UIStore {
  sidebarOpen: boolean;
  settingsOpen: boolean;
  newSessionOpen: boolean;
  panelMode: PanelMode;
  setSidebarOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setNewSessionOpen: (open: boolean) => void;
  setPanelMode: (mode: PanelMode) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  settingsOpen: false,
  newSessionOpen: false,
  panelMode: 'session',
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setNewSessionOpen: (open) => set({ newSessionOpen: open }),
  setPanelMode: (mode) => set({ panelMode: mode }),
}));
