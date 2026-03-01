import { useDmStore } from '../stores/dmStore';
import { useUIStore } from '../stores/uiStore';
import { relativeTime } from '../utils/relativeTime';
import type { DmConversation } from '../types';

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
