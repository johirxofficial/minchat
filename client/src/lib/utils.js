export function classNames(...parts) {
  return parts.filter(Boolean).join(' ');
}

export function initials(name = '?') {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function hueFor(value = '') {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 360;
  }
  return hash;
}

export function avatarStyle(seed) {
  const hue = hueFor(String(seed || 'minchat'));
  return {
    background: `linear-gradient(140deg, hsl(${hue} 62% 52%), hsl(${(hue + 48) % 360} 68% 42%))`
  };
}

export function timeAgo(input) {
  if (!input) return '';
  const date = new Date(input);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return '';
  const sec = Math.round(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function shortTime(input) {
  if (!input) return '';
  const date = new Date(input);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function listTime(input) {
  if (!input) return '';
  const date = new Date(input);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return shortTime(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (now.getTime() - date.getTime() < 7 * 86400000) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function dayLabel(input) {
  const date = new Date(input);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric'
  });
}

export function fullDate(input) {
  if (!input) return '';
  return new Date(input).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export function fileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function duration(seconds) {
  if (seconds == null) return '';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function clock(seconds) {
  return duration(seconds);
}

export function debounce(fn, wait = 300) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

const URL_RE = /(https?:\/\/[^\s<>"']+)/gi;

/**
 * Split message text into plain and link segments. React renders each segment
 * as text/anchor, so no HTML is ever injected.
 */
export function linkify(text) {
  const value = String(text ?? '');
  const out = [];
  let lastIndex = 0;
  for (const match of value.matchAll(URL_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) out.push({ type: 'text', value: value.slice(lastIndex, index) });
    out.push({ type: 'link', value: match[0] });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < value.length) out.push({ type: 'text', value: value.slice(lastIndex) });
  return out;
}

export function truncate(value, max = 90) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function conversationName(conversation, meId) {
  if (!conversation) return 'Conversation';
  if (conversation.type === 'group') return conversation.name || 'Group chat';
  const other = conversation.otherUser || conversation.members?.find((m) => m.id !== meId);
  return other?.displayName || other?.username || 'Conversation';
}

export function conversationAvatar(conversation) {
  if (!conversation) return null;
  if (conversation.type === 'group') return conversation.avatarUrl;
  return conversation.otherUser?.avatarUrl || null;
}

export function lastMessagePreview(conversation, meId) {
  const last = conversation?.lastMessage;
  if (!last) return 'No messages yet';
  const prefix =
    conversation.type === 'group' && last.senderId
      ? last.senderId === meId
        ? 'You: '
        : `${last.senderName || 'Someone'}: `
      : last.senderId === meId
        ? 'You: '
        : '';
  if (last.deleted) return 'This message was deleted';
  return `${prefix}${last.body || ''}`;
}

export function isImage(file) {
  return file?.mime?.startsWith('image/');
}

export function isVideo(file) {
  return file?.mime?.startsWith('video/');
}

export function isAudio(file) {
  return file?.mime?.startsWith('audio/');
}

export function initialsAvatar(name) {
  return initials(name);
}

export const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡', '👏', '🔥', '🎉', '🙏', '💯', '✅'];

export const REACTION_SET = ['👍', '❤️', '😂', '😮', '😢', '😡', '👏', '🔥', '🎉', '🙏', '💯', '✅', '😍', '😎', '🤔', '😴', '🙌', '💪', '👀', '🤝', '🥳', '😭', '😅', '🫶'];

export const PICKER_EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃',
  '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜',
  '🤪', '🤨', '🧐', '🤓', '😎', '🥳', '😏', '😒', '😞', '😔', '😟', '😕',
  '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬',
  '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😴',
  '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑',
  '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '🤖',
  '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🙈', '🙉',
  '🙊', '💋', '💌', '💘', '💝', '💖', '💗', '💓', '💞', '💕', '💟', '❣️',
  '💔', '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💯', '💢',
  '💥', '💫', '💦', '💨', '🕳️', '💣', '💬', '👁️‍🗨️', '🗨️', '🗯️', '💭', '💤',
  '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘',
  '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛',
  '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾',
  '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀',
  '👁️', '👅', '👄', '🔥', '✨', '🌟', '⭐', '🌞', '🌈', '☀️', '🌤️', '⛅',
  '🌧️', '⛈️', '🌩️', '❄️', '☃️', '⛄', '🌊', '🎉', '🎊', '🎈', '🎁', '🎂'
];
