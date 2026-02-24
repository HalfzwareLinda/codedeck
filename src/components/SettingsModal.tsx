import { useState, useEffect } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { AppConfig, AgentMode } from '../types';

export default function SettingsModal() {
  const config = useSessionStore((s) => s.config);
  const updateConfig = useSessionStore((s) => s.updateConfig);
  const setSettingsOpen = useSessionStore((s) => s.setSettingsOpen);

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

  useEffect(() => {
    if (config) setLocal(config);
  }, [config]);

  const handleSave = () => {
    updateConfig(local);
    setSettingsOpen(false);
  };

  const inputStyle = {
    width: '100%',
    height: 48,
    background: 'var(--bg-input)',
    border: '1px solid var(--border-medium)',
    borderRadius: 4,
    padding: '0 12px',
    fontSize: 14,
    color: 'var(--text-primary)',
  };

  const labelStyle = {
    fontSize: 12,
    fontWeight: 700 as const,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 4,
    display: 'block',
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.8)',
      zIndex: 200,
    }} onClick={() => setSettingsOpen(false)}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 500,
          maxWidth: '95vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--bg-surface)',
          borderRadius: 8,
          padding: 24,
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>Settings</span>
          <button
            onClick={() => setSettingsOpen(false)}
            style={{ fontSize: 20, cursor: 'pointer', color: 'var(--text-secondary)', width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ×
          </button>
        </div>

        {/* Authentication */}
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: 'var(--text-primary)' }}>Authentication</h3>

          <label style={labelStyle}>Anthropic API Key</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              type={showApiKey ? 'text' : 'password'}
              value={local.anthropic_api_key || ''}
              onChange={(e) => setLocal({ ...local, anthropic_api_key: e.target.value || null })}
              placeholder="sk-ant-..."
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              style={{ height: 48, padding: '0 12px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 13 }}
            >
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>

          <label style={labelStyle}>GitHub Personal Access Token</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              type={showPat ? 'text' : 'password'}
              value={local.github_pat || ''}
              onChange={(e) => setLocal({ ...local, github_pat: e.target.value || null })}
              placeholder="ghp_..."
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={() => setShowPat(!showPat)}
              style={{ height: 48, padding: '0 12px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 13 }}
            >
              {showPat ? 'Hide' : 'Show'}
            </button>
          </div>

          <label style={labelStyle}>GitHub Username</label>
          <input
            value={local.github_username || ''}
            onChange={(e) => setLocal({ ...local, github_username: e.target.value || null })}
            placeholder="username"
            style={{ ...inputStyle, marginBottom: 16 }}
          />
        </div>

        {/* Preferences */}
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: 'var(--text-primary)' }}>Preferences</h3>

          <label style={labelStyle}>Default Mode</label>
          <select
            value={local.default_mode}
            onChange={(e) => setLocal({ ...local, default_mode: e.target.value as AgentMode })}
            style={{ ...inputStyle, marginBottom: 16, cursor: 'pointer' }}
          >
            <option value="plan">Plan</option>
            <option value="auto">Auto</option>
          </select>

          <label style={labelStyle}>Model</label>
          <select
            value={local.model}
            onChange={(e) => setLocal({ ...local, model: e.target.value })}
            style={{ ...inputStyle, marginBottom: 16, cursor: 'pointer' }}
          >
            <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
            <option value="claude-opus-4-6">Claude Opus 4.6</option>
          </select>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 14 }}>Auto-push on complete</span>
            <button
              onClick={() => setLocal({ ...local, auto_push_on_complete: !local.auto_push_on_complete })}
              style={{
                width: 48,
                height: 28,
                borderRadius: 14,
                background: local.auto_push_on_complete ? 'var(--text-primary)' : 'var(--border-medium)',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.2s',
              }}
            >
              <div style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: local.auto_push_on_complete ? 'var(--bg-black)' : 'var(--text-secondary)',
                position: 'absolute',
                top: 3,
                left: local.auto_push_on_complete ? 23 : 3,
                transition: 'left 0.2s',
              }} />
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 14 }}>Notifications</span>
            <button
              onClick={() => setLocal({ ...local, notifications_enabled: !local.notifications_enabled })}
              style={{
                width: 48,
                height: 28,
                borderRadius: 14,
                background: local.notifications_enabled ? 'var(--text-primary)' : 'var(--border-medium)',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.2s',
              }}
            >
              <div style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: local.notifications_enabled ? 'var(--bg-black)' : 'var(--text-secondary)',
                position: 'absolute',
                top: 3,
                left: local.notifications_enabled ? 23 : 3,
                transition: 'left 0.2s',
              }} />
            </button>
          </div>
        </div>

        <button
          onClick={handleSave}
          style={{
            width: '100%',
            height: 56,
            background: 'var(--text-primary)',
            color: 'var(--bg-black)',
            fontSize: 16,
            fontWeight: 700,
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
