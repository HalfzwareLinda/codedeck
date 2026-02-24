import { useState } from 'react';
import { useSessionStore } from '../stores/sessionStore';

export default function NewSessionModal() {
  const setNewSessionOpen = useSessionStore((s) => s.setNewSessionOpen);
  const createSession = useSessionStore((s) => s.createSession);
  const sessions = useSessionStore((s) => s.sessions);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [loading, setLoading] = useState(false);

  // Get existing group names for autocomplete
  const existingGroups = [...new Set(sessions.map((s) => s.group).filter(Boolean))];

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    await createSession(name.trim(), group.trim() || 'DEFAULT', repoUrl.trim(), branch.trim() || 'main');
    setLoading(false);
    setNewSessionOpen(false);
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
      alignItems: 'flex-end',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)',
      zIndex: 200,
    }} onClick={() => setNewSessionOpen(false)}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 500,
          background: 'var(--bg-surface)',
          borderRadius: '12px 12px 0 0',
          padding: 24,
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>New Session</span>
          <button
            onClick={() => setNewSessionOpen(false)}
            style={{ fontSize: 20, cursor: 'pointer', color: 'var(--text-secondary)', width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ×
          </button>
        </div>

        <label style={labelStyle}>Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Session name"
          autoFocus
          style={{ ...inputStyle, marginBottom: 16 }}
        />

        <label style={labelStyle}>Group</label>
        <input
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          placeholder="e.g., WORK, PERSONAL"
          list="groups"
          style={{ ...inputStyle, marginBottom: 16 }}
        />
        <datalist id="groups">
          {existingGroups.map((g) => <option key={g} value={g} />)}
        </datalist>

        <label style={labelStyle}>Repository</label>
        <input
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/user/repo"
          style={{ ...inputStyle, marginBottom: 16 }}
        />

        <label style={labelStyle}>Branch</label>
        <input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
          style={{ ...inputStyle, marginBottom: 24 }}
        />

        <button
          onClick={handleCreate}
          disabled={!name.trim() || loading}
          style={{
            width: '100%',
            height: 56,
            background: name.trim() ? 'var(--text-primary)' : 'var(--border-medium)',
            color: name.trim() ? 'var(--bg-black)' : 'var(--text-muted)',
            fontSize: 16,
            fontWeight: 700,
            borderRadius: 4,
            cursor: name.trim() ? 'pointer' : 'default',
            transition: 'background 0.2s',
          }}
        >
          {loading ? 'Cloning...' : 'Clone & Start'}
        </button>
      </div>
    </div>
  );
}
