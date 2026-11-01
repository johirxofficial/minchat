import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import {
  ArrowLeft,
  Info,
  MessageCircle,
  Phone,
  Search,
  ShieldAlert,
  Video,
  Users2
} from 'lucide-react';
import { Avatar, Button, ConfirmDialog, EmptyState, Field, IconButton, Modal, PageLoader, Spinner } from '../components/ui';
import ConversationList from '../components/chat/ConversationList';
import NewConversationModal from '../components/chat/NewConversationModal';
import MessageBubble from '../components/chat/MessageBubble';
import Composer from '../components/chat/Composer';
import ConversationDetails from '../components/chat/ConversationDetails';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { useCall } from '../context/CallContext';
import { useToast } from '../context/ToastContext';
import { endpoints } from '../lib/api';
import {
  conversationAvatar,
  conversationName,
  dayLabel,
  timeAgo
} from '../lib/utils';

const REPORT_REASONS = [
  ['spam', 'Spam or unwanted messages'],
  ['harassment', 'Harassment or bullying'],
  ['impersonation', 'Impersonation'],
  ['inappropriate_media', 'Inappropriate media'],
  ['scam', 'Scam or fraud'],
  ['other', 'Something else']
];

function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export default function ChatPage() {
  const { user } = useAuth();
  const {
    conversations,
    activeId,
    activeConversation,
    messagesByConv,
    hasMoreByConv,
    loadingMessages,
    typingByConv,
    presence,
    openConversation,
    closeConversation,
    loadOlder,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    refreshConversation,
    loadConversations
  } = useChat();
  const { startCall } = useCall();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { openSearch } = useOutletContext() || {};

  const [query, setQuery] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState('spam');
  const [reportDetails, setReportDetails] = useState('');
  const [reporting, setReporting] = useState(false);

  const messages = activeId ? messagesByConv[activeId] || [] : [];
  const meId = user?.id;
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const stickToBottom = useRef(true);
  const previousConversation = useRef(null);

  useEffect(() => {
    const conversationId = new URLSearchParams(location.search).get('c');
    if (conversationId && conversationId !== activeId) openConversation(conversationId);
  }, [location.search, activeId, openConversation]);

  useEffect(() => {
    setReplyTo(null);
    setEditing(null);
    setDetailsOpen(false);
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    stickToBottom.current = true;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [activeId, loadingMessages]);

  useEffect(() => {
    if (activeId !== previousConversation.current) {
      previousConversation.current = activeId;
      return;
    }
    if (stickToBottom.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ block: 'end' });
    }
  }, [messages.length, activeId]);

  function selectConversation(id) {
    setDetailsOpen(false);
    navigate(`/?c=${id}`, { replace: true });
    openConversation(id);
  }

  function goBack() {
    closeConversation();
    setDetailsOpen(false);
    navigate('/', { replace: true });
  }

  async function handleOlder() {
    const el = scrollRef.current;
    if (!el) return;
    const previousHeight = el.scrollHeight;
    await loadOlder(activeId);
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight - previousHeight;
    });
  }

  async function handleSend(payload) {
    await sendMessage({ conversationId: activeId, ...payload });
  }

  async function handleEditSave(body) {
    await editMessage(editing.id, body);
    setEditing(null);
    toast.success('Message updated');
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteMessage(deleteTarget.id);
      toast.success('Message deleted');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  }

  async function react(message, emoji) {
    try {
      await toggleReaction(message, emoji);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submitReport(event) {
    event.preventDefault();
    if (!reportTarget) return;
    setReporting(true);
    try {
      await endpoints.report({
        userId: reportTarget.sender?.id || activeConversation?.otherUser?.id,
        reason: reportReason,
        details: reportDetails.trim(),
        messageId: reportTarget.id,
        conversationId: activeId
      });
      toast.success('Report submitted. Thank you for helping keep MinChat safe.');
      setReportTarget(null);
      setReportDetails('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReporting(false);
    }
  }

  const other = activeConversation?.otherUser;
  const online = other ? presence[other.id]?.online ?? other.online ?? null : null;
  const typing = activeId ? typingByConv[activeId] || [] : [];
  const isGroup = activeConversation?.type === 'group';
  const name = activeConversation ? conversationName(activeConversation, meId) : '';
  const canCall = activeConversation && !isGroup && activeConversation.canSend && other;

  const replyName = useMemo(() => {
    if (!editing) return null;
    return null;
  }, [editing]);

  function senderNameFor(message) {
    if (!message?.replyTo?.senderId) return null;
    const found = messages.find((m) => m.id === message.replyTo.id);
    if (found?.sender?.displayName) return found.sender.displayName;
    const member = activeConversation?.members?.find((m) => m.id === message.replyTo.senderId);
    return member?.displayName || null;
  }

  if (!activeConversation) {
    return (
      <div className="chat-layout">
        <ConversationList
          query={query}
          onQuery={setQuery}
          onNewChat={() => setNewChatOpen(true)}
          onSelect={selectConversation}
        />
        <section className="panel thread-panel thread-empty">
          <div className="thread-empty-inner">
            <span className="brand-mark brand-mark-xl">m</span>
            <h2>Welcome to MinChat</h2>
            <p>
              Choose a conversation, or find someone new. Messages, calls and media stay between
              you and the people you trust.
            </p>
            <div className="thread-empty-actions">
              <Button icon={MessageCircle} onClick={() => setNewChatOpen(true)}>
                New conversation
              </Button>
              <Button variant="secondary" icon={Search} onClick={() => navigate('/discover')}>
                Find people
              </Button>
            </div>
            <ul className="thread-empty-points">
              <li>
                <ShieldAlert size={16} /> Only friends can message or call you.
              </li>
              <li>
                <Users2 size={16} /> Make groups with the people you talk to most.
              </li>
              <li>
                <Phone size={16} /> Voice and video calls with screen sharing.
              </li>
            </ul>
          </div>
          <NewConversationModal
            open={newChatOpen}
            onClose={() => setNewChatOpen(false)}
            onCreated={selectConversation}
          />
        </section>
      </div>
    );
  }

  return (
    <div className={`chat-layout has-active ${detailsOpen ? 'has-details' : ''}`}>
      <ConversationList
        query={query}
        onQuery={setQuery}
        onNewChat={() => setNewChatOpen(true)}
        onSelect={selectConversation}
      />

      <section className="panel thread-panel" aria-label={`Conversation with ${name}`}>
        <header className="thread-head">
          <IconButton label="Back to conversations" icon={ArrowLeft} onClick={goBack} className="thread-back" />
          <button type="button" className="thread-identity" onClick={() => setDetailsOpen((value) => !value)}>
            <Avatar
              name={name}
              src={conversationAvatar(activeConversation)}
              size={42}
              square={isGroup}
              online={isGroup ? null : online}
            />
            <span className="thread-copy">
              <strong>
                {name}
                {isGroup ? <span className="thread-group-count">{activeConversation.members?.length || 0}</span> : null}
              </strong>
              <span className="thread-status">
                {typing.length ? (
                  <span className="is-typing">
                    {typing.map((t) => t.displayName || 'Someone').join(', ')} typing…
                  </span>
                ) : isGroup ? (
                  `${activeConversation.members?.length || 0} members`
                ) : online ? (
                  'Online'
                ) : other?.lastActiveAt ? (
                  `Last active ${timeAgo(other.lastActiveAt)}`
                ) : (
                  'Offline'
                )}
              </span>
            </span>
          </button>

          <div className="thread-actions">
            <IconButton label="Search messages" icon={Search} onClick={openSearch} />
            {!isGroup ? (
              <>
                <IconButton
                  label={canCall ? 'Start a voice call' : 'You can call this person once you are friends'}
                  icon={Phone}
                  onClick={() => startCall(activeConversation, 'voice')}
                  disabled={!canCall}
                />
                <IconButton
                  label={canCall ? 'Start a video call' : 'You can call this person once you are friends'}
                  icon={Video}
                  onClick={() => startCall(activeConversation, 'video')}
                  disabled={!canCall}
                />
              </>
            ) : null}
            <IconButton
              label="Conversation details"
              icon={Info}
              onClick={() => setDetailsOpen((value) => !value)}
              className={detailsOpen ? 'is-active' : ''}
            />
          </div>
        </header>

        <div
          className="messages"
          ref={scrollRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
          }}
        >
          {hasMoreByConv[activeId] ? (
            <div className="load-older">
              <Button variant="ghost" size="sm" onClick={handleOlder}>
                Load earlier messages
              </Button>
            </div>
          ) : null}

          {loadingMessages && messages.length === 0 ? (
            <div className="messages-loading">
              <Spinner size={22} />
              <span>Loading messages…</span>
            </div>
          ) : messages.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title={isGroup ? 'A fresh group' : 'Say hello'}
              description={
                isGroup
                  ? 'Send the first message and get the conversation started.'
                  : `This is the beginning of your conversation with ${name}.`
              }
              compact
            />
          ) : (
            messages.map((message, index) => {
              const previous = messages[index - 1];
              const next = messages[index + 1];
              const showDate = !previous || !sameDay(previous.createdAt, message.createdAt);
              const gap = previous ? new Date(message.createdAt) - new Date(previous.createdAt) : Infinity;
              const nextGap = next ? new Date(next.createdAt) - new Date(message.createdAt) : Infinity;
              const sameSenderAsPrevious =
                previous && previous.type !== 'system' && previous.sender?.id === message.sender?.id;
              const sameSenderAsNext =
                next && next.type !== 'system' && next.sender?.id === message.sender?.id;
              const showName = isGroup && message.type !== 'system' && (!sameSenderAsPrevious || gap > 5 * 60_000);
              const showAvatar = isGroup && (!sameSenderAsNext || nextGap > 5 * 60_000);
              return (
                <div key={message.id}>
                  {showDate ? (
                    <div className="date-separator">
                      <span>{dayLabel(message.createdAt)}</span>
                    </div>
                  ) : null}
                  <MessageBubble
                    message={message}
                    own={message.sender?.id === meId}
                    isGroup={isGroup}
                    showName={showName}
                    showAvatar={showAvatar}
                    canDeleteAsAdmin={isGroup && activeConversation.myRole === 'admin'}
                    replyName={senderNameFor(message)}
                    onReply={(target) => {
                      setEditing(null);
                      setReplyTo(target);
                    }}
                    onEdit={(target) => {
                      setReplyTo(null);
                      setEditing(target);
                    }}
                    onDelete={(target) => setDeleteTarget(target)}
                    onReact={react}
                    onReport={(target) => {
                      setReportReason('spam');
                      setReportTarget(target);
                    }}
                    onOpenImage={(url, alt) => setLightbox({ url, alt })}
                  />
                </div>
              );
            })
          )}

          {typing.length ? (
            <div className="typing-row" aria-live="polite">
              <span className="typing-bubble">
                <i />
                <i />
                <i />
              </span>
              <span>{typing.map((t) => t.displayName || 'Someone').join(', ')} is typing…</span>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>

        <Composer
          conversation={activeConversation}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onSend={handleSend}
          onEditSave={handleEditSave}
        />
      </section>

      {detailsOpen ? (
        <ConversationDetails
          conversation={activeConversation}
          onClose={() => setDetailsOpen(false)}
          onChanged={async () => {
            await refreshConversation(activeId);
            await loadConversations();
          }}
          onLeft={() => {
            setDetailsOpen(false);
            closeConversation();
            navigate('/', { replace: true });
            loadConversations();
          }}
          onBlocked={() => {
            setDetailsOpen(false);
            closeConversation();
            navigate('/', { replace: true });
            loadConversations();
          }}
        />
      ) : null}

      <NewConversationModal
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onCreated={selectConversation}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Delete this message?"
        description="The message will be removed for everyone. This cannot be undone."
        confirmLabel="Delete message"
      />

      <Modal
        open={Boolean(lightbox)}
        onClose={() => setLightbox(null)}
        title={lightbox?.alt || 'Image'}
        size="lg"
        closeOnBackdrop
      >
        {lightbox ? <img className="lightbox-image" src={lightbox.url} alt={lightbox.alt || ''} /> : null}
      </Modal>

      <Modal
        open={Boolean(reportTarget)}
        onClose={() => setReportTarget(null)}
        title="Report this message"
        description="The message will be attached as evidence for administrators. They cannot see the rest of your conversation."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReportTarget(null)} disabled={reporting}>Cancel</Button>
            <Button variant="danger" onClick={submitReport} loading={reporting}>Submit report</Button>
          </>
        }
      >
        <form onSubmit={submitReport} className="stack">
          <Field label="Reason">
            <select value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
              {REPORT_REASONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Details" optional>
            <textarea
              rows={4}
              maxLength={1000}
              value={reportDetails}
              onChange={(event) => setReportDetails(event.target.value)}
              placeholder="What should the administrator know?"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
