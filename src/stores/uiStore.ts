import { create } from 'zustand';
import { PanelMode, RemoteMachine } from '../types';

interface UIStore {
  sidebarOpen: boolean;
  settingsOpen: boolean;
  newSessionOpen: boolean;
  newSessionMachine: RemoteMachine | null; // set when opening modal for a remote machine
  panelMode: PanelMode;
  setSidebarOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setNewSessionOpen: (open: boolean, machine?: RemoteMachine | null) => void;
  setPanelMode: (mode: PanelMode) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  settingsOpen: false,
  newSessionOpen: false,
  newSessionMachine: null,
  panelMode: 'session',
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setNewSessionOpen: (open, machine) => set({ newSessionOpen: open, newSessionMachine: open ? (machine ?? null) : null }),
  setPanelMode: (mode) => set({ panelMode: mode }),
}));
