import { useQuickPromptStore } from '../stores/quickPromptStore';
import { useSessionStore } from '../stores/sessionStore';

export default function QuickPromptBar({ sessionId, disabled }: { sessionId: string; disabled?: boolean }) {
  const prompts = useQuickPromptStore((s) => s.prompts);
  const sendMessage = useSessionStore((s) => s.sendMessage);

  if (prompts.length === 0) return null;

  return (
    <div className="quick-prompt-bar">
      {prompts.map((qp) => (
        <button
          key={qp.id}
          className="quick-prompt-pill"
          onClick={() => !disabled && sendMessage(sessionId, qp.prompt)}
          disabled={disabled}
          title={qp.prompt}
          type="button"
        >
          {qp.label}
        </button>
      ))}
    </div>
  );
}
