import { useMemo } from 'react';
import { MessageCirclePlus, Search, Users, VolumeX, X } from 'lucide-react';
import { Avatar, EmptyState, IconButton } from '../ui';
import NoticeBanner from '../NoticeBanner';
import VerifyEmailBanner from '../VerifyEmailBanner';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import {
  conversationAvatar,
  conversationName,
  lastMessagePreview,
  listTime
} from '../../lib/utils';

export default function ConversationList({ query, onQuery, onNewChat, onSelect }) {
  const { user } = useAuth();
  const { conversations, activeId, typingByConv, presence, loadingConversations, unreadChats } = useChat();
  const meId = user?.id;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((conversation) => {
      const name = conversationName(conversation, meId).toLowerCase();
      const preview = lastMessagePreview(conversation, meId).toLowerCase();
      return name.includes(q) || preview.includes(q);
    });
  }, [conversations, query, meId]);

  return (
    <section className="panel conversation-panel" aria-label="Conversations">
      <header className="panel-head">
        <div className="panel-title">
          <h1>Chats</h1>
          <p>{unreadChats > 0 ? `${unreadChats} unread message${unreadChats === 1 ? '' : 's'}` : 'You’re all caught up'}</p>
        </div>
        <IconButton label="Start a new chat" icon={MessageCirclePlus} onClick={onNewChat} variant="soft" />
      </header>

      <div className="panel-search">
        <Search size={16} />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
        />
        {query ? (
          <button type="button" className="input-action" onClick={() => onQuery('')} aria-label="Clear search">
            <X size={14} />
          </button>
        ) : null}
      </div>

      <NoticeBanner />
      <VerifyEmailBanner />

      <div className="conv-list">
        {loadingConversations && conversations.length === 0 ? (
          <div className="conv-skeletons" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((index) => (
              <div className="conv-skeleton" key={index}>
                <span className="skeleton skeleton-avatar" />
                <span className="skeleton-lines">
                  <span className="skeleton skeleton-line" />
                  <span className="skeleton skeleton-line skeleton-line-short" />
                </span>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={query ? Search : MessageCirclePlus}
            title={query ? 'No conversations found' : 'Your inbox is quiet'}
            description={
              query
                ? 'Try a different name or clear the search.'
                : 'Find a friend, send a request, and start your first conversation.'
            }
            compact
          >
            {!query ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={onNewChat}>
                Start chatting
              </button>
            ) : null}
          </EmptyState>
        ) : (
          filtered.map((conversation) => {
            const name = conversationName(conversation, meId);
            const typing = typingByConv[conversation.id] || [];
            const other = conversation.otherUser;
            const online =
              conversation.type === 'group'
                ? null
                : presence[other?.id]?.online ?? other?.online ?? null;
            const unread = Number(conversation.unreadCount) || 0;
            const muted = conversation.notificationLevel === 'none';
            return (
              <button
                type="button"
                key={conversation.id}
                className={`conv-item ${conversation.id === activeId ? 'is-active' : ''}`}
                onClick={() => onSelect(conversation.id)}
              >
                <Avatar
                  name={name}
                  src={conversationAvatar(conversation)}
                  size={50}
                  online={online}
                  square={conversation.type === 'group'}
                />
                <span className="conv-copy">
                  <span className="conv-top">
                    <span className="conv-name">
                      {conversation.type === 'group' ? <Users size={14} className="conv-group-icon" /> : null}
                      {name}
                    </span>
                    <span className={`conv-time ${unread ? 'is-unread' : ''}`}>
                      {listTime(conversation.lastMessageAt)}
                    </span>
                  </span>
                  <span className="conv-bottom">
                    <span className={`conv-preview ${typing.length ? 'is-typing' : ''} ${unread ? 'is-unread' : ''}`}>
                      {typing.length
                        ? `${typing[0].displayName || 'Someone'} is typing…`
                        : lastMessagePreview(conversation, meId)}
                    </span>
                    <span className="conv-meta">
                      {muted ? <VolumeX size={13} aria-label="Muted" /> : null}
                      {unread > 0 ? (
                        <span className="unread-pill" aria-label={`${unread} unread`}>
                          {unread > 99 ? '99+' : unread}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
