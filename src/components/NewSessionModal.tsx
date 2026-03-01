import { useState } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import '../styles/modal.css';

export default function NewSessionModal() {
  const setNewSessionOpen = useUIStore((s) => s.setNewSessionOpen);
  const machine = useUIStore((s) => s.newSessionMachine);
  const createSession = useSessionStore((s) => s.createSession);
  const createRemoteSession = useSessionStore((s) => s.createRemoteSession);
  const sessions = useSessionStore((s) => s.sessions);
  const remoteSessions = useSessionStore((s) => s.remoteSessions);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [loading, setLoading] = useState(false);

  const close = () => setNewSessionOpen(false);

  // --- Remote machine mode ---
  if (machine) {
    const machineSessions = remoteSessions[machine.pubkeyHex] || [];
    const projects = [...new Set(machineSessions.map((s) => s.project).filter(Boolean))];

    const handleRemoteCreate = async () => {
      setLoading(true);
      await createRemoteSession(machine);
      setLoading(false);
      close();
    };

    return (
      <div className="modal-overlay bottom-sheet" onClick={close}>
        <div className="modal-content bottom-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <span className="modal-title">New Session</span>
            <button className="modal-close" onClick={close}>&times;</button>
          </div>

          <label className="modal-label">Machine</label>
          <div className="modal-info">{machine.hostname}</div>

          {projects.length > 0 && (
            <>
              <label className="modal-label">Workspace</label>
              <div className="modal-info">{projects.join(', ')}</div>
            </>
          )}

          <p className="modal-hint" style={{ marginBottom: 24 }}>
            Opens a new Claude Code terminal in the VSCode workspace. Session name and project are assigned automatically.
          </p>

          <button
            className="modal-primary-btn"
            onClick={handleRemoteCreate}
            disabled={loading}
          >
            {loading ? 'Starting...' : 'Start Session'}
          </button>
        </div>
      </div>
    );
  }

  // --- Local session mode ---
  const existingGroups = [...new Set(sessions.map((s) => s.group).filter(Boolean))];

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    await createSession(name.trim(), group.trim() || 'DEFAULT', repoUrl.trim(), branch.trim() || 'main');
    setLoading(false);
    close();
  };

  return (
    <div className="modal-overlay bottom-sheet" onClick={close}>
      <div className="modal-content bottom-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">New Session</span>
          <button className="modal-close" onClick={close}>&times;</button>
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
