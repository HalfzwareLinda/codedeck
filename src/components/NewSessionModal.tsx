import { useState } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import '../styles/modal.css';

export default function NewSessionModal() {
  const setNewSessionOpen = useUIStore((s) => s.setNewSessionOpen);
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

  return (
    <div className="modal-overlay bottom-sheet" onClick={() => setNewSessionOpen(false)}>
      <div className="modal-content bottom-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">New Session</span>
          <button className="modal-close" onClick={() => setNewSessionOpen(false)}>
            &times;
          </button>
        </div>

        <label className="modal-label">Name</label>
        <input
          className="modal-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Session name"
          autoFocus
        />

        <label className="modal-label">Group</label>
        <input
          className="modal-input"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          placeholder="e.g., WORK, PERSONAL"
          list="groups"
        />
        <datalist id="groups">
          {existingGroups.map((g) => <option key={g} value={g} />)}
        </datalist>

        <label className="modal-label">Repository</label>
        <input
          className="modal-input"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/user/repo"
        />

        <label className="modal-label">Branch</label>
        <input
          className="modal-input"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
          style={{ marginBottom: 24 }}
        />

        <button
          className="modal-primary-btn"
          onClick={handleCreate}
          disabled={!name.trim() || loading}
        >
          {loading ? 'Cloning...' : 'Clone & Start'}
        </button>
      </div>
    </div>
  );
}
