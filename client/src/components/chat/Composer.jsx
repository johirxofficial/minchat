import { useEffect, useRef, useState } from 'react';
import {
  CornerUpLeft,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  PencilLine,
  SendHorizontal,
  Smile,
  Square,
  Trash2,
  X
} from 'lucide-react';
import { IconButton } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { useToast } from '../../context/ToastContext';
import { endpoints } from '../../lib/api';
import { fileSize, PICKER_EMOJIS, truncate } from '../../lib/utils';

function attachmentIcon(kind) {
  if (kind === 'image') return ImageIcon;
  if (kind === 'audio') return Mic;
  return FileText;
}

export default function Composer({
  conversation,
  replyTo,
  onCancelReply,
  editing,
  onCancelEdit,
  onSend,
  onEditSave
}) {
  const { me } = useAuth();
  const { sendTyping } = useChat();
  const toast = useToast();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState([]);
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const emojiRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const recordStreamRef = useRef(null);
  const typingTimer = useRef(null);
  const lastTypingSent = useRef(0);
  const dragCounter = useRef(0);

  const disabledReason = !conversation?.canSend
    ? conversation?.sendBlockedReason === 'NOT_FRIENDS'
      ? 'You can message each other once you’re friends.'
      : conversation?.sendBlockedReason === 'CONTACT_DISABLED'
        ? 'This person is not accepting messages right now.'
        : 'This conversation is read-only.'
    : null;

  useEffect(() => {
    setText(editing?.body || '');
    setAttachments([]);
    setEmojiOpen(false);
    setError('');
    if (editing) textareaRef.current?.focus();
  }, [editing, conversation?.id]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, Math.max(24, el.scrollHeight))}px`;
  }, [text]);

  useEffect(() => {
    if (!emojiOpen) return undefined;
    const onClick = (event) => {
      if (emojiRef.current && !emojiRef.current.contains(event.target)) setEmojiOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [emojiOpen]);

  useEffect(() => {
    return () => {
      clearTimeout(typingTimer.current);
      clearInterval(recordTimerRef.current);
      recordStreamRef.current?.getTracks().forEach((track) => track.stop());
      recorderRef.current?.state === 'recording' && recorderRef.current.stop();
      for (const attachment of attachments) {
        if (attachment.preview) URL.revokeObjectURL(attachment.preview);
      }
    };
  }, []);

  function changed(value) {
    setText(value);
    if (!conversation?.id || editing) return;
    const now = Date.now();
    if (value.trim()) {
      if (now - lastTypingSent.current > 2200) {
        sendTyping(conversation.id, true);
        lastTypingSent.current = now;
      }
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => sendTyping(conversation.id, false), 2200);
    } else {
      clearTimeout(typingTimer.current);
      sendTyping(conversation.id, false);
    }
  }

  function insertEmoji(emoji) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    changed(next);
    requestAnimationFrame(() => {
      el?.focus();
      const position = start + emoji.length;
      el?.setSelectionRange(position, position);
    });
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const maxMb = me?.limits?.maxUploadMb ?? 25;
    const remaining = 10 - (attachments.length + uploading.length);
    if (files.length > remaining) {
      toast.error(`You can attach up to 10 files at once`);
    }
    for (const file of files.slice(0, Math.max(0, remaining))) {
      if (file.size > maxMb * 1024 * 1024) {
        toast.error(`${file.name} is larger than ${maxMb} MB`);
        continue;
      }
      const tempId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      setUploading((prev) => [...prev, { tempId, name: file.name, progress: 0, preview }]);
      try {
        const data = await endpoints.uploadFile(file, (progress) => {
          setUploading((prev) => prev.map((u) => (u.tempId === tempId ? { ...u, progress } : u)));
        });
        setAttachments((prev) => [
          ...prev,
          {
            id: data.file.id,
            name: data.file.name,
            mime: data.file.mime,
            size: data.file.size,
            kind: data.file.kind,
            url: data.file.url,
            preview: preview || (data.file.kind === 'image' ? data.file.url : null)
          }
        ]);
      } catch (err) {
        if (preview) URL.revokeObjectURL(preview);
        toast.error(err.message);
      } finally {
        setUploading((prev) => prev.filter((u) => u.tempId !== tempId));
      }
    }
  }

  function removeAttachment(id) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.preview?.startsWith('blob:')) URL.revokeObjectURL(target.preview);
      return prev.filter((a) => a.id !== id);
    });
  }

  function typeForAttachments(list) {
    if (!list.length) return 'text';
    const kinds = new Set(list.map((a) => a.kind));
    if (kinds.size === 1 && kinds.has('image')) return 'image';
    if (kinds.size === 1 && kinds.has('video')) return 'video';
    if (kinds.size === 1 && kinds.has('audio') && list.length === 1) return 'audio';
    return 'file';
  }

  async function submit(event) {
    event?.preventDefault();
    if (disabledReason) return;
    if (uploading.length) {
      toast.info('Wait for your files to finish uploading');
      return;
    }
    if (editing) {
      if (!text.trim()) {
        setError('A message cannot be empty');
        return;
      }
      setSending(true);
      try {
        await onEditSave(text.trim());
      } finally {
        setSending(false);
      }
      return;
    }
    if (!text.trim() && !attachments.length) return;
    setSending(true);
    setError('');
    try {
      await onSend({
        body: text.trim() || null,
        replyToId: replyTo?.id || null,
        attachmentIds: attachments.map((a) => a.id),
        type: typeForAttachments(attachments)
      });
      setText('');
      setAttachments([]);
      onCancelReply?.();
      clearTimeout(typingTimer.current);
      sendTyping(conversation.id, false);
      textareaRef.current?.focus();
    } catch {
      // Error toast is raised by the chat context.
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
    if (event.key === 'Escape' && editing) onCancelEdit?.();
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Voice recording is not supported in this browser (or needs HTTPS).');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        clearInterval(recordTimerRef.current);
        recordStreamRef.current?.getTracks().forEach((track) => track.stop());
        recordStreamRef.current = null;
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        if (!blob.size) return;
        const extension = type.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `voice-message-${Date.now()}.${extension}`, { type });
        const tempId = `voice-${Date.now()}`;
        setUploading((prev) => [...prev, { tempId, name: 'Voice message', progress: 0 }]);
        try {
          const data = await endpoints.uploadFile(file, (progress) => {
            setUploading((prev) => prev.map((u) => (u.tempId === tempId ? { ...u, progress } : u)));
          });
          await onSend({
            body: null,
            replyToId: replyTo?.id || null,
            attachmentIds: [data.file.id],
            type: 'audio'
          });
          onCancelReply?.();
        } catch (err) {
          toast.error(err.message);
        } finally {
          setUploading((prev) => prev.filter((u) => u.tempId !== tempId));
        }
      };
      recorder.start(250);
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      toast.error('Microphone permission was denied.');
    }
  }

  function stopRecording(cancel = false) {
    setRecording(false);
    clearInterval(recordTimerRef.current);
    if (cancel) {
      recorderRef.current.onstop = null;
      chunksRef.current = [];
      recordStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordStreamRef.current = null;
    }
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
  }

  function onPaste(event) {
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  }

  if (disabledReason) {
    return (
      <div className="composer composer-blocked">
        <p>
          <PencilLine size={16} /> {disabledReason}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`composer-wrap ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault();
        dragCounter.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragCounter.current = 0;
        setDragging(false);
        addFiles(event.dataTransfer.files);
      }}
    >
      {dragging ? <div className="composer-drop">Drop files to attach</div> : null}

      {editing ? (
        <div className="composer-banner edit-banner">
          <PencilLine size={15} />
          <span>Editing message</span>
          <button type="button" onClick={onCancelEdit} aria-label="Cancel editing">
            <X size={14} />
          </button>
        </div>
      ) : replyTo ? (
        <div className="composer-banner">
          <CornerUpLeft size={15} />
          <span>
            <strong>{replyTo.sender?.displayName || 'Replying'}</strong>{' '}
            {truncate(replyTo.body || 'Attachment', 80)}
          </span>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply">
            <X size={14} />
          </button>
        </div>
      ) : null}

      {attachments.length || uploading.length ? (
        <div className="composer-attachments">
          {attachments.map((attachment) => {
            const Icon = attachmentIcon(attachment.kind);
            return (
              <div className="attachment-chip" key={attachment.id}>
                {attachment.kind === 'image' && attachment.preview ? (
                  <img src={attachment.preview} alt="" />
                ) : (
                  <span className="attachment-chip-icon">
                    <Icon size={16} />
                  </span>
                )}
                <span className="attachment-chip-copy">
                  <strong>{truncate(attachment.name, 24)}</strong>
                  <em>{fileSize(attachment.size)}</em>
                </span>
                <button type="button" onClick={() => removeAttachment(attachment.id)} aria-label={`Remove ${attachment.name}`}>
                  <X size={13} />
                </button>
              </div>
            );
          })}
          {uploading.map((upload) => (
            <div className="attachment-chip is-uploading" key={upload.tempId}>
              <span className="attachment-chip-icon">
                <Loader2 size={16} className="spin" />
              </span>
              <span className="attachment-chip-copy">
                <strong>{truncate(upload.name, 22)}</strong>
                <span className="upload-bar">
                  <i style={{ width: `${upload.progress}%` }} />
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {recording ? (
        <div className="composer-recording">
          <span className="recording-dot" />
          <span className="recording-time">{Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, '0')}</span>
          <span>Recording voice message…</span>
          <div className="recording-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => stopRecording(true)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => stopRecording(false)} icon={Square}>
              Send
            </button>
          </div>
        </div>
      ) : (
        <form className="composer" onSubmit={submit}>
          <div className="composer-field">
            <IconButton
              label="Emoji"
              icon={Smile}
              onClick={() => setEmojiOpen((value) => !value)}
              className="composer-tool"
              type="button"
            />
            <IconButton
              label="Attach a file"
              icon={Paperclip}
              onClick={() => fileInputRef.current?.click()}
              className="composer-tool"
              type="button"
            />
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={(event) => changed(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={editing ? 'Edit your message…' : 'Write a message…'}
              aria-label="Message"
              maxLength={4000}
            />
            <span className="composer-hint">Enter to send · Shift+Enter for a new line</span>
          </div>

          <div className="composer-actions">
            {!editing && !text.trim() && !attachments.length ? (
              <IconButton
                label="Record a voice message"
                icon={Mic}
                onClick={startRecording}
                className="composer-tool"
                type="button"
              />
            ) : null}
            <button
              type="submit"
              className="composer-send"
              disabled={sending || Boolean(uploading.length) || (!text.trim() && !attachments.length)}
              aria-label={editing ? 'Save edit' : 'Send message'}
              title={editing ? 'Save edit' : 'Send'}
            >
              {sending ? <Loader2 size={18} className="spin" /> : <SendHorizontal size={18} />}
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/wav,application/pdf,text/plain,text/csv,text/markdown,.docx,.xlsx,.pptx,.zip"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </form>
      )}

      {emojiOpen ? (
        <div className="emoji-picker" ref={emojiRef}>
          <div className="emoji-picker-head">
            <strong>Emoji</strong>
            <IconButton label="Close emoji picker" icon={X} size={14} onClick={() => setEmojiOpen(false)} />
          </div>
          <div className="emoji-grid">
            {PICKER_EMOJIS.map((emoji) => (
              <button type="button" key={emoji} onClick={() => insertEmoji(emoji)} aria-label={`Insert ${emoji}`}>
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <p className="form-error composer-error">{error}</p> : null}
      {recording ? (
        <button type="button" className="composer-record-cancel" aria-label="Cancel recording" onClick={() => stopRecording(true)}>
          <Trash2 size={16} />
        </button>
      ) : null}
    </div>
  );
}
