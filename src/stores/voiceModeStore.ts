import { create } from 'zustand';
import { persistGet, persistSet } from '../services/persistStore';

const PERSIST_KEY = 'codedeck_voice_mode';

interface VoiceModeSettings {
  enabled: boolean;
  speechRate: number;
  autoListenAfterRead: boolean;
}

interface VoiceModeStore extends VoiceModeSettings {
  loaded: boolean;
  /** Updated by ttsService via useVoiceMode — true when TTS is actively speaking. */
  speaking: boolean;
  setEnabled: (enabled: boolean) => void;
  setSpeechRate: (rate: number) => void;
  setAutoListenAfterRead: (on: boolean) => void;
  loadPersisted: () => Promise<void>;
}

const DEFAULTS: VoiceModeSettings = {
  enabled: false,
  speechRate: 1.0,
  autoListenAfterRead: false,
};

function persist(settings: VoiceModeSettings) {
  persistSet(PERSIST_KEY, settings);
}

export const useVoiceModeStore = create<VoiceModeStore>((set, get) => ({
  ...DEFAULTS,
  loaded: false,
  speaking: false,

  setEnabled: (enabled) => {
    set({ enabled });
    const { speechRate, autoListenAfterRead } = get();
    persist({ enabled, speechRate, autoListenAfterRead });
  },

  setSpeechRate: (speechRate) => {
    const clamped = Math.max(0.8, Math.min(1.5, speechRate));
    set({ speechRate: clamped });
    const { enabled, autoListenAfterRead } = get();
    persist({ enabled, speechRate: clamped, autoListenAfterRead });
  },

  setAutoListenAfterRead: (autoListenAfterRead) => {
    set({ autoListenAfterRead });
    const { enabled, speechRate } = get();
    persist({ enabled, speechRate, autoListenAfterRead });
  },

  loadPersisted: async () => {
    const saved = await persistGet<VoiceModeSettings>(PERSIST_KEY);
    if (saved) {
      set({
        enabled: saved.enabled ?? DEFAULTS.enabled,
        speechRate: saved.speechRate ?? DEFAULTS.speechRate,
        autoListenAfterRead: saved.autoListenAfterRead ?? DEFAULTS.autoListenAfterRead,
        loaded: true,
      });
    } else {
      set({ loaded: true });
    }
  },
}));
