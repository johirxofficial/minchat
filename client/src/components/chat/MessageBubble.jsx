import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Copy,
  CornerUpLeft,
  Download,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  SmilePlus,
  Trash2,
  Flag
} from 'lucide-react';
import { Avatar, IconButton } from '../ui';
import {
  classNames,
  EMOJIS,
  fileSize,
  linkify,
  shortTime,
  truncate
} from '../../lib/utils';

function Receipt({ receipts, optimistic, failed }) {
  if (optimistic) {
    return (
      <span className="receipt is-pending" title="Sending">
        <Clock size={13} />
      </span>
    );
  }
  if (failed) {
    return (
      <span className="receipt is-failed" title="Message not sent">
        <AlertCircle size={13} /> Not sent
      </span>
    );
  }
  const total = receipts?.total ?? 0;
  const delivered = receipts?.delivered ?? 0;
  const read = receipts?.read ?? 0;
  if (total > 0 && read >= total) {
    return (
      <span className="receipt is-read" title="Read">
        <CheckCheck size={14} />
      </span>
    );
  }
  if (total > 0 && delivered >= total) {
    return (
      <span className="receipt is-delivered" title="Delivered">
        <CheckCheck size={14} />
      </span>
    );
  }
  return (
    <span className="receipt" title="Sent">
      <Check size={14} />
    </span>
  );
}

function Attachments({ attachments, onOpenImage }) {
  if (!attachments?.length) return null;
  const images = attachments.filter((a) => a.mime?.startsWith('image/'));
  const videos = attachments.filter((a) => a.mime?.startsWith('video/'));
  const audios = attachments.filter((a) => a.mime?.startsWith('audio/'));
  const files = attachments.filter(
    (a) => !a.mime?.startsWith('image/') && !a.mime?.startsWith('video/') && !a.mime?.startsWith('audio/')
  );

  return (
    <div className="msg-attachments">
      {images.length ? (
        <div className={`msg-image-grid count-${Math.min(images.length, 4)}`}>
          {images.slice(0, 4).map((image, index) => (
            <button
              type="button"
              key={image.id}
              className="msg-image"
              onClick={() => onOpenImage?.(image.url, image.name)}
              aria-label={`Open image ${image.name}`}
            >
              <img src={image.url} alt={image.name || 'Photo'} loading="lazy" />
              {index === 3 && images.length > 4 ? <span className="msg-image-more">+{images.length - 4}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {videos.map((video) => (
        <video key={video.id} className="msg-video" src={video.url} controls preload="metadata" playsInline>
          <track kind="captions" />
        </video>
      ))}

      {audios.map((audio) => (
        <div className="msg-audio" key={audio.id}>
          <audio src={audio.url} controls preload="metadata" />
          {audio.durationMs ? <span>{(audio.durationMs / 1000).toFixed(1)}s</span> : null}
        </div>
      ))}

      {files.map((file) => (
        <a key={file.id} className="msg-file" href={file.url} download={file.name} target="_blank" rel="noreferrer">
          <span className="msg-file-icon">
            <FileText size={20} />
          </span>
          <span className="msg-file-copy">
            <strong>{truncate(file.name, 42)}</strong>
            <em>{fileSize(file.size)}</em>
          </span>
          <Download size={16} />
        </a>
      ))}
    </div>
  );
}

export default function MessageBubble({
  message,
  own,
  showAvatar,
  showName,
  isGroup,
  canDeleteAsAdmin,
  replyName,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onReport,
  onOpenImage
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef(null);
  const reactRef = useRef(null);

  useEffect(() => {
    if (!menuOpen && !reactOpen) return undefined;
    const onClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
      if (reactRef.current && !reactRef.current.contains(event.target)) setReactOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen, reactOpen]);

  if (message.type === 'system') {
    return (
      <div className="system-message">
        <span>{message.body}</span>
      </div>
    );
  }

  const deleted = message.isDeleted || Boolean(message.deletedAt);
  const body = deleted ? null : message.body;
  const attachments = deleted ? [] : message.attachments || [];
  const reactions = message.reactions || [];
  const canEdit = own && !deleted && Boolean(body) && ['text', 'image', 'video', 'audio', 'file'].includes(message.type);
  const canDelete = !deleted && (own || canDeleteAsAdmin);
  const senderName = message.sender?.displayName || message.sender?.username || 'Unknown';

  async function copyText() {
    try {
      await navigator.clipboard.writeText(body || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked; the menu simply closes.
    }
    setMenuOpen(false);
  }

  return (
    <div
      className={classNames(
        'msg-row',
        own ? 'is-own' : 'is-other',
        message.optimistic && 'is-optimistic',
        message.failed && 'is-failed'
      )}
      data-message-id={message.id}
    >
      {!own && isGroup ? (
        <span className="msg-avatar">
          {showAvatar ? (
            <Avatar name={senderName} src={message.sender?.avatarUrl} size={34} />
          ) : (
            <span className="msg-avatar-spacer" />
          )}
        </span>
      ) : null}

      <div className="msg-stack">
        {!own && isGroup && showName ? <span className="msg-sender">{senderName}</span> : null}

        <div className="msg-bubble-wrap">
          <div className={classNames('msg-bubble', deleted && 'is-deleted', attachments.length && 'has-media')}>
            {message.replyTo && !deleted ? (
              <div className="msg-reply-quote">
                <CornerUpLeft size={12} />
                <span>
                  <strong>{replyName || 'Message'}</strong>
                  <em>
                    {message.replyTo.type === 'image'
                      ? 'Photo'
                      : message.replyTo.type === 'video'
                        ? 'Video'
                        : message.replyTo.type === 'audio'
                          ? 'Voice message'
                          : message.replyTo.type === 'file'
                            ? 'Attachment'
                            : truncate(message.replyTo.body || 'Original message', 90)}
                  </em>
                </span>
              </div>
            ) : null}

            <Attachments attachments={attachments} onOpenImage={onOpenImage} />

            {body ? (
              <p className="msg-text">
                {linkify(body).map((segment, index) =>
                  segment.type === 'link' ? (
                    <a
                      key={`${segment.value}-${index}`}
                      href={segment.value}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      {segment.value}
                    </a>
                  ) : (
                    <span key={index}>{segment.value}</span>
                  )
                )}
              </p>
            ) : null}

            {deleted ? (
              <p className="msg-deleted">
                <Trash2 size={13} /> This message was deleted
              </p>
            ) : null}

            <span className="msg-meta">
              {message.editedAt && !deleted ? <span className="msg-edited">edited</span> : null}
              <span className="msg-time">{shortTime(message.createdAt)}</span>
              {own ? (
                <Receipt receipts={message.receipts} optimistic={message.optimistic} failed={message.failed} />
              ) : null}
            </span>
          </div>

          {!deleted ? (
            <div className="msg-tools" role="group" aria-label="Message actions">
              <button
                type="button"
                className="msg-tool"
                onClick={() => {
                  setReactOpen((value) => !value);
                  setMenuOpen(false);
                }}
                aria-label="Add a reaction"
                title="React"
              >
                <SmilePlus size={15} />
              </button>
              <button type="button" className="msg-tool" onClick={() => onReply?.(message)} aria-label="Reply" title="Reply">
                <CornerUpLeft size={15} />
              </button>
              <button
                type="button"
                className="msg-tool"
                onClick={() => {
                  setMenuOpen((value) => !value);
                  setReactOpen(false);
                }}
                aria-label="More actions"
                title="More"
              >
                <MoreHorizontal size={15} />
              </button>
            </div>
          ) : null}

          {reactOpen ? (
            <div className="react-pop" ref={reactRef}>
              {EMOJIS.map((emoji) => (
                <button
                  type="button"
                  key={emoji}
                  onClick={() => {
                    onReact?.(message, emoji);
                    setReactOpen(false);
                  }}
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}

          {menuOpen ? (
            <div className={classNames('msg-menu', own ? 'align-right' : 'align-left')} ref={menuRef}>
              <button type="button" onClick={() => { onReply?.(message); setMenuOpen(false); }}>
                <CornerUpLeft size={14} /> Reply
              </button>
              {body ? (
                <button type="button" onClick={copyText}>
                  <Copy size={14} /> {copied ? 'Copied' : 'Copy text'}
                </button>
              ) : null}
              {canEdit ? (
                <button type="button" onClick={() => { onEdit?.(message); setMenuOpen(false); }}>
                  <Pencil size={14} /> Edit
                </button>
              ) : null}
              {canDelete ? (
                <button type="button" className="is-danger" onClick={() => { onDelete?.(message); setMenuOpen(false); }}>
                  <Trash2 size={14} /> Delete
                </button>
              ) : null}
              {!own ? (
                <button type="button" className="is-danger" onClick={() => { onReport?.(message); setMenuOpen(false); }}>
                  <Flag size={14} /> Report
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {reactions.length ? (
          <div className={classNames('msg-reactions', own && 'is-own')}>
            {reactions.map((reaction) => (
              <button
                type="button"
                key={reaction.emoji}
                className={classNames('reaction', reaction.me && 'is-mine')}
                onClick={() => onReact?.(message, reaction.emoji)}
                title={`${reaction.count} reaction${reaction.count === 1 ? '' : 's'} — click to ${reaction.me ? 'remove' : 'add'}`}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
            ))}
            <button
              type="button"
              className="reaction reaction-add"
              onClick={() => setReactOpen(true)}
              aria-label="Add another reaction"
            >
              <Plus size={12} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
