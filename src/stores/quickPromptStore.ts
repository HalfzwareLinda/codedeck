import { create } from 'zustand';
import { persistGet, persistSet } from '../services/persistStore';
import type { QuickPrompt } from '../types';

const PERSIST_KEY = 'codedeck_quick_prompts';

interface QuickPromptStore {
  prompts: QuickPrompt[];
  loaded: boolean;
  loadPersisted: () => Promise<void>;
  addPrompt: (label: string, prompt: string) => void;
  updatePrompt: (id: string, label: string, prompt: string) => void;
  removePrompt: (id: string) => void;
  reorderPrompts: (prompts: QuickPrompt[]) => void;
}

function persist(prompts: QuickPrompt[]) {
  persistSet(PERSIST_KEY, prompts);
}

export const useQuickPromptStore = create<QuickPromptStore>((set, get) => ({
  prompts: [],
  loaded: false,

  loadPersisted: async () => {
    const saved = await persistGet<QuickPrompt[]>(PERSIST_KEY);
    set({ prompts: saved ?? [], loaded: true });
  },

  addPrompt: (label, prompt) => {
    const next = [...get().prompts, { id: crypto.randomUUID(), label, prompt }];
    set({ prompts: next });
    persist(next);
  },

  updatePrompt: (id, label, prompt) => {
    const next = get().prompts.map(p => p.id === id ? { ...p, label, prompt } : p);
    set({ prompts: next });
    persist(next);
  },

  removePrompt: (id) => {
    const next = get().prompts.filter(p => p.id !== id);
    set({ prompts: next });
    persist(next);
  },

  reorderPrompts: (prompts) => {
    set({ prompts });
    persist(prompts);
  },
}));
