import { useState, useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import { AppConfig, AgentMode } from '../types';
import '../styles/modal.css';

export default function SettingsModal() {
  const config = useSessionStore((s) => s.config);
  const updateConfig = useSessionStore((s) => s.updateConfig);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);

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
          <div className="input-with-toggle" style={{ marginBottom: 16 }}>
            <input
              className="modal-input"
              type={showApiKey ? 'text' : 'password'}
              value={local.anthropic_api_key || ''}
              onChange={(e) => setLocal({ ...local, anthropic_api_key: e.target.value || null })}
              placeholder="sk-ant-..."
            />
            <button className="show-hide-btn" onClick={() => setShowApiKey(!showApiKey)}>
              {showApiKey ? 'Hide' : 'Show'}
            </button>
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

        <button className="modal-primary-btn" onClick={handleSave}>
          Save
        </button>
      </div>
    </div>
  );
}
