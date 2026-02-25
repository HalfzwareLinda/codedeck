import { useDmStore } from '../stores/dmStore';
import { useUIStore } from '../stores/uiStore';
import type { DmConversation } from '../types';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export default function DmTile({ conversation, isSelected }: { conversation: DmConversation; isSelected: boolean }) {
  const setActiveConversation = useDmStore((s) => s.setActiveConversation);
  const setPanelMode = useUIStore((s) => s.setPanelMode);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  const handleClick = () => {
    setActiveConversation(conversation.id);
    setPanelMode('dm');
    setSidebarOpen(false);
  };

  return (
    <div
      className={`dm-tile${isSelected ? ' selected' : ''}`}
      onClick={handleClick}
    >
      <div className="dm-tile-info">
        <div className="dm-tile-name">{conversation.display_name}</div>
        <div className="dm-tile-time">{relativeTime(conversation.last_message_at)}</div>
      </div>
      {conversation.unread_count > 0 && (
        <div className="dm-tile-unread">{conversation.unread_count}</div>
      )}
    </div>
  );
}
