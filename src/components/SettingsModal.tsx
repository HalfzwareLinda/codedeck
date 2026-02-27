import { useState, useEffect, useMemo } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import { useDmStore } from '../stores/dmStore';
import { AppConfig, AgentMode } from '../types';
import { parsePrivateKey, getPubkeyHex } from '../services/nostrService';
import { api } from '../ipc/tauri';
import * as nip19 from 'nostr-tools/nip19';
import '../styles/modal.css';

export default function SettingsModal() {
  const config = useSessionStore((s) => s.config);
  const updateConfig = useSessionStore((s) => s.updateConfig);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const nostrConfig = useDmStore((s) => s.nostrConfig);
  const updateNostrConfig = useDmStore((s) => s.updateNostrConfig);

  const [local, setLocal] = useState<AppConfig>(config || {
    anthropic_api_key: null,
    github_pat: null,
    github_username: null,
    default_mode: 'plan' as AgentMode,
    auto_push_on_complete: true,
    notifications_enabled: true,
    workspace_base_path: '',
    max_sessions: 20,
    model: 'claude-sonnet-4-20250514',
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [showPat, setShowPat] = useState(false);
  const [showNsec, setShowNsec] = useState(false);
  const [nostrKey, setNostrKey] = useState(nostrConfig.private_key_hex || '');
  const [relayList, setRelayList] = useState(nostrConfig.relays.join('\n'));
  const [apiKeyStatus, setApiKeyStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle');
  const [apiKeyError, setApiKeyError] = useState('');

  const handleTestApiKey = async () => {
    const key = local.anthropic_api_key?.trim();
    if (!key) return;
    setApiKeyStatus('testing');
    setApiKeyError('');
    try {
      const result = await api.testApiKey(key);
      if (result) {
        setApiKeyStatus('valid');
      } else {
        setApiKeyStatus('invalid');
        setApiKeyError('No response from API');
      }
    } catch (e: unknown) {
      setApiKeyStatus('invalid');
      setApiKeyError(String(e) || 'Unknown error');
    }
  };

  useEffect(() => {
    if (config) setLocal(config);
  }, [config]);

  const derivedNpub = useMemo(() => {
    if (!nostrKey) return '';
    const sk = parsePrivateKey(nostrKey);
    if (!sk) return '';
    const hex = getPubkeyHex(sk);
    return nip19.npubEncode(hex);
  }, [nostrKey]);

  const handleSave = () => {
    updateConfig(local);

    // Parse and save nostr config — store as hex internally
    const sk = nostrKey ? parsePrivateKey(nostrKey) : null;
    const privateKeyHex = sk
      ? Array.from(sk).map(b => b.toString(16).padStart(2, '0')).join('')
      : null;
    const relays = relayList
      .split('\n')
      .map(r => r.trim())
      .filter(r => r.startsWith('wss://') || r.startsWith('ws://'));

    updateNostrConfig({
      private_key_hex: privateKeyHex,
      relays: relays.length > 0 ? relays : ['wss://relay.damus.io', 'wss://nos.lol'],
    });

    setSettingsOpen(false);
  };

  return (
    <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="modal-close" onClick={() => setSettingsOpen(false)}>
            &times;
          </button>
        </div>

        {/* Authentication */}
        <div className="modal-section">
          <h3 className="modal-section-title">Authentication</h3>

          <label className="modal-label">Anthropic API Key</label>
          <div className="input-with-toggle" style={{ marginBottom: 4 }}>
            <input
              className="modal-input"
              type={showApiKey ? 'text' : 'password'}
              value={local.anthropic_api_key || ''}
              onChange={(e) => {
                setLocal({ ...local, anthropic_api_key: e.target.value || null });
                setApiKeyStatus('idle');
                setApiKeyError('');
              }}
              placeholder="sk-ant-api03-... or sk-ant-oat01-..."
            />
            <button className="show-hide-btn" onClick={() => setShowApiKey(!showApiKey)}>
              {showApiKey ? 'Hide' : 'Show'}
            </button>
            <button
              className="show-hide-btn"
              onClick={handleTestApiKey}
              disabled={apiKeyStatus === 'testing' || !local.anthropic_api_key}
              style={{ marginLeft: 4 }}
            >
              {apiKeyStatus === 'testing' ? '...' : 'Test'}
            </button>
          </div>
          <div style={{ fontSize: 11, padding: '0 0 12px', minHeight: 16 }}>
            {apiKeyStatus === 'testing' && (
              <span style={{ color: 'var(--text-muted)' }}>Testing API key...</span>
            )}
            {apiKeyStatus === 'valid' && (
              <span style={{ color: '#22c55e' }}>Valid</span>
            )}
            {apiKeyStatus === 'invalid' && (
              <span style={{ color: '#ef4444' }}>{apiKeyError || 'Invalid key'}</span>
            )}
            {apiKeyStatus === 'idle' && !local.anthropic_api_key && (
              <span style={{ color: 'var(--text-muted)' }}>Required for agent sessions</span>
            )}
          </div>

          <label className="modal-label">GitHub Personal Access Token</label>
          <div className="input-with-toggle" style={{ marginBottom: 16 }}>
            <input
              className="modal-input"
              type={showPat ? 'text' : 'password'}
              value={local.github_pat || ''}
              onChange={(e) => setLocal({ ...local, github_pat: e.target.value || null })}
              placeholder="ghp_..."
            />
            <button className="show-hide-btn" onClick={() => setShowPat(!showPat)}>
              {showPat ? 'Hide' : 'Show'}
            </button>
          </div>

          <label className="modal-label">GitHub Username</label>
          <input
            className="modal-input"
            value={local.github_username || ''}
            onChange={(e) => setLocal({ ...local, github_username: e.target.value || null })}
            placeholder="username"
          />
        </div>

        {/* Preferences */}
        <div className="modal-section">
          <h3 className="modal-section-title">Preferences</h3>

          <label className="modal-label">Default Mode</label>
          <select
            className="modal-input"
            value={local.default_mode}
            onChange={(e) => setLocal({ ...local, default_mode: e.target.value as AgentMode })}
            style={{ cursor: 'pointer' }}
          >
            <option value="plan">Plan</option>
            <option value="auto">Auto</option>
          </select>

          <label className="modal-label">Model</label>
          <select
            className="modal-input"
            value={local.model}
            onChange={(e) => setLocal({ ...local, model: e.target.value })}
            style={{ cursor: 'pointer' }}
          >
            <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
            <option value="claude-opus-4-6">Claude Opus 4.6</option>
          </select>

          <div className="modal-toggle-row">
            <span style={{ fontSize: 14 }}>Auto-push on complete</span>
            <button
              className={`toggle-switch ${local.auto_push_on_complete ? 'on' : 'off'}`}
              onClick={() => setLocal({ ...local, auto_push_on_complete: !local.auto_push_on_complete })}
            >
              <div className="toggle-knob" />
            </button>
          </div>

          <div className="modal-toggle-row">
            <span style={{ fontSize: 14 }}>Notifications</span>
            <button
              className={`toggle-switch ${local.notifications_enabled ? 'on' : 'off'}`}
              onClick={() => setLocal({ ...local, notifications_enabled: !local.notifications_enabled })}
            >
              <div className="toggle-knob" />
            </button>
          </div>
        </div>

        {/* Nostr Identity */}
        <div className="modal-section">
          <h3 className="modal-section-title">Nostr Identity</h3>

          <label className="modal-label">Private Key (nsec or hex)</label>
          <div className="input-with-toggle" style={{ marginBottom: 16 }}>
            <input
              className="modal-input"
              type={showNsec ? 'text' : 'password'}
              value={nostrKey}
              onChange={(e) => setNostrKey(e.target.value)}
              placeholder="nsec1... or 64-char hex"
            />
            <button className="show-hide-btn" onClick={() => setShowNsec(!showNsec)}>
              {showNsec ? 'Hide' : 'Show'}
            </button>
          </div>

          {derivedNpub && (
            <>
              <label className="modal-label">Your Public Key</label>
              <input
                className="modal-input"
                value={derivedNpub}
                readOnly
                style={{ color: 'var(--text-secondary)', marginBottom: 16 }}
              />
            </>
          )}

          <label className="modal-label">DM Relays (one per line)</label>
          <textarea
            className="modal-input"
            value={relayList}
            onChange={(e) => setRelayList(e.target.value)}
            placeholder={'wss://relay.damus.io\nwss://nos.lol'}
            style={{ height: 80, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        <button className="modal-primary-btn" onClick={handleSave}>
          Save
        </button>
      </div>
    </div>
  );
}
