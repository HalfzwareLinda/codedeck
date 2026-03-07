import { useSessionStore } from '../stores/sessionStore';
import '../styles/sidebar.css';

export default function UndoToast() {
  const undoToast = useSessionStore((s) => s.undoToast);
  const undoDeleteSession = useSessionStore((s) => s.undoDeleteSession);

  if (!undoToast) return null;

  return (
    <div className="undo-toast">
      <span className="undo-toast-label">Deleted "{undoToast.label}"</span>
      <button className="undo-toast-btn" onClick={undoDeleteSession}>Undo</button>
    </div>
  );
}
