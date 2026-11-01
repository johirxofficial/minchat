import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { endpoints } from '../lib/api';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { useToast } from './ToastContext';

const ChatContext = createContext(null);

function previewFor(message, meId) {
  const deleted = message.isDeleted || message.deletedAt;
  const body = deleted
    ? 'This message was deleted'
    : message.body ||
      (message.type === 'image'
        ? 'Photo'
        : message.type === 'video'
          ? 'Video'
          : message.type === 'audio'
            ? 'Voice message'
            : message.type === 'file'
              ? 'Attachment'
              : '');
  return {
    id: message.id,
    type: message.type,
    body,
    deleted,
    senderId: message.sender?.id ?? meId,
    senderName: message.sender?.displayName ?? null,
    createdAt: message.createdAt,
    hasAttachment: Boolean(message.attachments?.length)
  };
}

function upsert(list, message) {
  const byId = list.findIndex((m) => m.id === message.id);
  if (byId >= 0) {
    const next = [...list];
    next[byId] = { ...next[byId], ...message, optimistic: false, failed: false };
    return next;
  }
  if (message.clientNonce) {
    const byNonce = list.findIndex((m) => m.optimistic && m.clientNonce === message.clientNonce);
    if (byNonce >= 0) {
      const next = [...list];
      next[byNonce] = { ...message, optimistic: false, failed: false };
      return next;
    }
  }
  return [...list, message];
}

export function ChatProvider({ children }) {
  const { me, refresh: refreshMe } = useAuth();
  const { socket } = useSocket();
  const toast = useToast();
  const meId = me?.user?.id;

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messagesByConv, setMessagesByConv] = useState({});
  const [hasMoreByConv, setHasMoreByConv] = useState({});
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [typingByConv, setTypingByConv] = useState({});
  const [presence, setPresence] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const activeIdRef = useRef(null);
  const messagesRef = useRef({});
  const conversationsRef = useRef([]);
  const typingTimers = useRef(new Map());
  const refreshTimer = useRef(null);
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const setActive = useCallback((id) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  const applyMessages = useCallback((conversationId, updater) => {
    setMessagesByConv((prev) => {
      const current = prev[conversationId] || [];
      const next = typeof updater === 'function' ? updater(current) : updater;
      messagesRef.current = { ...messagesRef.current, [conversationId]: next };
      return { ...prev, [conversationId]: next };
    });
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const data = await endpoints.conversations();
      setConversations(data.conversations || []);
      conversationsRef.current = data.conversations || [];
      return data.conversations || [];
    } catch (err) {
      toast.error(err.message);
      return [];
    } finally {
      setLoadingConversations(false);
    }
  }, [toast]);

  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => loadConversations(), 350);
  }, [loadConversations]);

  const refreshConversation = useCallback(
    async (id) => {
      try {
        const { conversation } = await endpoints.conversation(id);
        setConversations((prev) => {
          const exists = prev.some((c) => c.id === id);
          if (!exists) return [conversation, ...prev];
          return prev.map((c) => (c.id === id ? { ...c, ...conversation } : c));
        });
        return conversation;
      } catch {
        return null;
      }
    },
    []
  );

  const markRead = useCallback(
    async (conversationId, messageId) => {
      if (!conversationId || !messageId) return;
      try {
        await endpoints.markRead(conversationId, messageId);
        setConversations((prev) =>
          prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
        );
        refreshMe().catch(() => {});
      } catch {
        // A read receipt failing is harmless; the next open retries.
      }
    },
    [refreshMe]
  );

  const loadNotifications = useCallback(async () => {
    try {
      const data = await endpoints.notifications();
      setNotifications(data.notifications || []);
      setUnreadNotifications(data.unread ?? 0);
    } catch {
      setNotifications([]);
    }
  }, []);

  useEffect(() => {
    if (!meId) {
      setConversations([]);
      setMessagesByConv({});
      messagesRef.current = {};
      setNotifications([]);
      setUnreadNotifications(0);
      setActive(null);
      hasLoadedOnce.current = false;
      return;
    }
    if (hasLoadedOnce.current) return;
    hasLoadedOnce.current = true;
    setLoadingConversations(true);
    loadConversations();
    loadNotifications();
  }, [meId, loadConversations, loadNotifications, setActive]);

  const openConversation = useCallback(
    async (id) => {
      if (!id) {
        setActive(null);
        return;
      }
      setActive(id);
      const cached = messagesRef.current[id];
      setLoadingMessages(!cached);
      try {
        const tasks = [refreshConversation(id)];
        if (!cached) tasks.push(endpoints.messages(id));
        const [, page] = await Promise.all(tasks);
        if (page) {
          applyMessages(id, page.messages || []);
          setHasMoreByConv((prev) => ({ ...prev, [id]: Boolean(page.hasMore) }));
        }
        const list = messagesRef.current[id] || [];
        const last = list[list.length - 1];
        if (last) markRead(id, last.id);
      } catch (err) {
        if (err.status !== 404) toast.error(err.message);
      } finally {
        setLoadingMessages(false);
      }
    },
    [applyMessages, markRead, refreshConversation, setActive, toast]
  );

  const closeConversation = useCallback(() => {
    setActive(null);
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [setActive]);

  const loadOlder = useCallback(
    async (id) => {
      const list = messagesRef.current[id] || [];
      if (!list.length || !hasMoreByConv[id]) return;
      try {
        const page = await endpoints.messages(id, { before: list[0].id, limit: 50 });
        applyMessages(id, (current) => [...(page.messages || []), ...current]);
        setHasMoreByConv((prev) => ({ ...prev, [id]: Boolean(page.hasMore) }));
      } catch (err) {
        toast.error(err.message);
      }
    },
    [applyMessages, hasMoreByConv, toast]
  );

  const sendTyping = useCallback(
    (conversationId, isTyping) => {
      if (!socket || !conversationId) return;
      socket.emit('typing', { conversationId, isTyping });
    },
    [socket]
  );

  const sendMessage = useCallback(
    async ({ conversationId, body = null, replyToId = null, attachmentIds = [], type = 'text' }) => {
      const nonce = `n-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const optimistic = {
        id: `temp-${nonce}`,
        clientNonce: nonce,
        conversationId,
        type,
        body,
        sender: me?.user
          ? {
              id: me.user.id,
              username: me.user.username,
              displayName: me.user.displayName,
              avatarUrl: me.user.avatarUrl
            }
          : null,
        replyTo: replyToId
          ? (() => {
              const original = (messagesRef.current[conversationId] || []).find((m) => m.id === replyToId);
              return original
                ? { id: original.id, body: original.body, type: original.type, senderId: original.sender?.id }
                : null;
            })()
          : null,
        reactions: [],
        attachments: [],
        receipts: { total: 0, delivered: 0, read: 0 },
        createdAt: new Date().toISOString(),
        optimistic: true,
        failed: false
      };
      applyMessages(conversationId, (list) => upsert(list, optimistic));
      setConversations((prev) => {
        const conv = prev.find((c) => c.id === conversationId);
        if (!conv) return prev;
        const updated = {
          ...conv,
          lastMessage: previewFor(optimistic, meId),
          lastMessageAt: optimistic.createdAt
        };
        return [updated, ...prev.filter((c) => c.id !== conversationId)];
      });

      try {
        const res = await endpoints.sendMessage(conversationId, {
          body,
          replyToId,
          attachmentIds,
          type,
          clientNonce: nonce
        });
        applyMessages(conversationId, (list) => upsert(list, res.message));
        return res.message;
      } catch (err) {
        applyMessages(conversationId, (list) =>
          list.map((m) => (m.clientNonce === nonce ? { ...m, failed: true, optimistic: false } : m))
        );
        toast.error(err.message);
        throw err;
      }
    },
    [applyMessages, me, meId, toast]
  );

  const editMessage = useCallback(
    async (messageId, body) => {
      const res = await endpoints.editMessage(messageId, body);
      const message = res.message;
      applyMessages(message.conversationId, (list) => upsert(list, message));
      return message;
    },
    [applyMessages]
  );

  const deleteMessage = useCallback(
    async (messageId) => {
      const res = await endpoints.deleteMessage(messageId);
      const message = res.message;
      applyMessages(message.conversationId, (list) => upsert(list, message));
      scheduleRefresh();
      return message;
    },
    [applyMessages, scheduleRefresh]
  );

  const toggleReaction = useCallback(
    async (message, emoji) => {
      const mine = (message.reactions || []).find((r) => r.emoji === emoji)?.me;
      const res = mine
        ? await endpoints.unreact(message.id, emoji)
        : await endpoints.react(message.id, emoji);
      applyMessages(message.conversationId, (list) =>
        list.map((m) => (m.id === message.id ? { ...m, reactions: res.reactions } : m))
      );
    },
    [applyMessages]
  );

  const startDirect = useCallback(
    async (userId) => {
      const { conversation } = await endpoints.direct(userId);
      await loadConversations();
      return conversation;
    },
    [loadConversations]
  );

  const createGroup = useCallback(
    async (name, memberIds) => {
      const { conversation } = await endpoints.group(name, memberIds);
      await loadConversations();
      return conversation;
    },
    [loadConversations]
  );

  const markNotificationsRead = useCallback(
    async (payload = {}) => {
      try {
        const res = await endpoints.markNotificationsRead(payload);
        setUnreadNotifications(res.unread ?? 0);
        setNotifications((prev) =>
          prev.map((n) =>
            payload.ids && !payload.ids.includes(n.id) && !payload.conversationId && !payload.all
              ? n
              : { ...n, readAt: n.readAt || new Date().toISOString() }
          )
        );
      } catch {
        // Ignore; badge will refresh on the next poll.
      }
    },
    []
  );

  useEffect(() => {
    if (!socket || !meId) return undefined;

    const onMessage = (message) => {
      if (!message?.conversationId) return;
      applyMessages(message.conversationId, (list) => upsert(list, message));
      const isActive = activeIdRef.current === message.conversationId;
      const mine = message.sender?.id === meId;

      setConversations((prev) => {
        const conv = prev.find((c) => c.id === message.conversationId);
        if (!conv) {
          scheduleRefresh();
          return prev;
        }
        const shouldRead = isActive && document.visibilityState === 'visible';
        const updated = {
          ...conv,
          lastMessage: previewFor(message, meId),
          lastMessageAt: message.createdAt,
          unreadCount: mine || shouldRead ? 0 : (conv.unreadCount || 0) + 1
        };
        return [updated, ...prev.filter((c) => c.id !== message.conversationId)];
      });

      if (!mine) {
        socket.emit('message:delivered', { messageIds: [message.id] });
        if (isActive && document.visibilityState === 'visible') {
          markRead(message.conversationId, message.id);
        }
      }
    };

    const onUpdated = (message) => {
      if (!message?.conversationId) return;
      applyMessages(message.conversationId, (list) => upsert(list, message));
      scheduleRefresh();
    };

    const onReactions = ({ messageId, conversationId, reactions }) => {
      applyMessages(conversationId, (list) =>
        list.map((m) => (m.id === messageId ? { ...m, reactions } : m))
      );
    };

    const onReceipts = ({ updates = [] }) => {
      for (const update of updates) {
        applyMessages(update.conversationId, (list) =>
          list.map((m) =>
            m.id === update.messageId
              ? { ...m, receipts: { total: update.total, delivered: update.delivered, read: update.read } }
              : m
          )
        );
      }
    };

    const onRead = ({ conversationId, userId }) => {
      if (userId === meId) {
        setConversations((prev) =>
          prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
        );
      }
    };

    const onTyping = ({ conversationId, userId, displayName, isTyping }) => {
      if (userId === meId) return;
      const key = `${conversationId}:${userId}`;
      if (typingTimers.current.has(key)) clearTimeout(typingTimers.current.get(key));
      setTypingByConv((prev) => {
        const current = (prev[conversationId] || []).filter((t) => t.userId !== userId);
        return {
          ...prev,
          [conversationId]: isTyping ? [...current, { userId, displayName }] : current
        };
      });
      if (isTyping) {
        const timer = setTimeout(() => {
          setTypingByConv((prev) => ({
            ...prev,
            [conversationId]: (prev[conversationId] || []).filter((t) => t.userId !== userId)
          }));
          typingTimers.current.delete(key);
        }, 4500);
        typingTimers.current.set(key, timer);
      }
    };

    const onPresence = ({ userId, online, lastActiveAt }) => {
      setPresence((prev) => ({ ...prev, [userId]: { online, lastActiveAt } }));
    };

    const onPresenceSnapshot = ({ users = [] }) => {
      setPresence((prev) => {
        const next = { ...prev };
        for (const u of users) next[u.userId] = { online: u.online, lastActiveAt: u.lastActiveAt };
        return next;
      });
    };

    const onConversationChanged = () => scheduleRefresh();

    const onNotification = (notification) => {
      setNotifications((prev) => {
        if (prev.some((n) => n.id === notification.id)) return prev;
        return [notification, ...prev].slice(0, 40);
      });
      setUnreadNotifications((n) => n + 1);
      if (notification.type === 'friend_request' && notification.actor) {
        toast.info(`${notification.actor.displayName} sent you a friend request`);
        window.dispatchEvent(new CustomEvent('minchat:friends-changed'));
      }
      if (notification.type === 'friend_accepted' && notification.actor) {
        toast.success(`${notification.actor.displayName} accepted your friend request`);
        window.dispatchEvent(new CustomEvent('minchat:friends-changed'));
        loadConversations();
      }
      if (notification.type === 'group_add') {
        toast.info('You were added to a group');
        loadConversations();
      }
    };

    const onFriendEvent = (payload) => {
      window.dispatchEvent(new CustomEvent('minchat:friends-changed', { detail: payload }));
      if (payload?.user?.displayName) toast.info(`${payload.user.displayName} is now your friend`);
      loadConversations();
    };

    const onRemoved = ({ conversationId }) => {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (activeIdRef.current === conversationId) setActive(null);
    };

    socket.on('message:new', onMessage);
    socket.on('message:updated', onUpdated);
    socket.on('message:reactions', onReactions);
    socket.on('message:receipts', onReceipts);
    socket.on('conversation:read', onRead);
    socket.on('typing', onTyping);
    socket.on('presence:update', onPresence);
    socket.on('presence:snapshot', onPresenceSnapshot);
    socket.on('conversation:update', onConversationChanged);
    socket.on('conversation:created', onConversationChanged);
    socket.on('conversation:removed', onRemoved);
    socket.on('notification:new', onNotification);
    socket.on('friend:request', onFriendEvent);
    socket.on('friend:accepted', onFriendEvent);
    socket.on('friend:removed', onFriendEvent);
    socket.on('relation:changed', onFriendEvent);
    socket.on('friend:request:update', onFriendEvent);

    return () => {
      socket.off('message:new', onMessage);
      socket.off('message:updated', onUpdated);
      socket.off('message:reactions', onReactions);
      socket.off('message:receipts', onReceipts);
      socket.off('conversation:read', onRead);
      socket.off('typing', onTyping);
      socket.off('presence:update', onPresence);
      socket.off('presence:snapshot', onPresenceSnapshot);
      socket.off('conversation:update', onConversationChanged);
      socket.off('conversation:created', onConversationChanged);
      socket.off('conversation:removed', onRemoved);
      socket.off('notification:new', onNotification);
      socket.off('friend:request', onFriendEvent);
      socket.off('friend:accepted', onFriendEvent);
      socket.off('friend:removed', onFriendEvent);
      socket.off('relation:changed', onFriendEvent);
      socket.off('friend:request:update', onFriendEvent);
      for (const timer of typingTimers.current.values()) clearTimeout(timer);
      typingTimers.current.clear();
      clearTimeout(refreshTimer.current);
    };
  }, [
    socket,
    meId,
    applyMessages,
    markRead,
    scheduleRefresh,
    toast,
    loadConversations,
    setActive
  ]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const id = activeIdRef.current;
      if (!id) return;
      const list = messagesRef.current[id] || [];
      const last = list[list.length - 1];
      if (last) markRead(id, last.id);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [markRead]);

  const unreadChats = useMemo(
    () => conversations.reduce((sum, c) => sum + (Number(c.unreadCount) || 0), 0),
    [conversations]
  );

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId]
  );

  useEffect(() => {
    const total = unreadChats + unreadNotifications;
    document.title = total > 0 ? `(${total}) MinChat` : 'MinChat';
  }, [unreadChats, unreadNotifications]);

  const value = useMemo(
    () => ({
      conversations,
      activeId,
      activeConversation,
      messagesByConv,
      hasMoreByConv,
      loadingConversations,
      loadingMessages,
      typingByConv,
      presence,
      notifications,
      unreadNotifications,
      unreadChats,
      openConversation,
      closeConversation,
      loadOlder,
      sendMessage,
      editMessage,
      deleteMessage,
      toggleReaction,
      markRead,
      sendTyping,
      startDirect,
      createGroup,
      refreshConversation,
      loadConversations,
      markNotificationsRead,
      loadNotifications
    }),
    [
      conversations,
      activeId,
      activeConversation,
      messagesByConv,
      hasMoreByConv,
      loadingConversations,
      loadingMessages,
      typingByConv,
      presence,
      notifications,
      unreadNotifications,
      unreadChats,
      openConversation,
      closeConversation,
      loadOlder,
      sendMessage,
      editMessage,
      deleteMessage,
      toggleReaction,
      markRead,
      sendTyping,
      startDirect,
      createGroup,
      refreshConversation,
      loadConversations,
      markNotificationsRead,
      loadNotifications
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
