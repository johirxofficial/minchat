import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, CheckCheck, MessageSquare, UserPlus, UserCheck, PhoneMissed, Users, ShieldAlert, X } from 'lucide-react';
import { useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';
import { IconButton } from './ui';
import { timeAgo } from '../lib/utils';

function iconFor(type) {
  if (type === 'message') return MessageSquare;
  if (type === 'friend_request') return UserPlus;
  if (type === 'friend_accepted') return UserCheck;
  if (type === 'missed_call') return PhoneMissed;
  if (type === 'group_add' || type === 'group_remove') return Users;
  return ShieldAlert;
}

function textFor(notification) {
  const actor = notification.actor?.displayName || 'Someone';
  if (notification.type === 'message') {
    return (
      <>
        <strong>{actor}</strong> {notification.payload?.conversationType === 'group' ? `in ${notification.payload?.conversationName}: ` : ': '}
        {notification.payload?.preview || 'New message'}
      </>
    );
  }
  if (notification.type === 'friend_request') return <><strong>{actor}</strong> sent you a friend request</>;
  if (notification.type === 'friend_accepted') return <><strong>{actor}</strong> accepted your friend request</>;
  if (notification.type === 'missed_call') return <><strong>{actor}</strong> tried to call you</>;
  if (notification.type === 'group_add') return <><strong>{actor}</strong> added you to {notification.payload?.groupName || 'a group'}</>;
  if (notification.type === 'group_remove') return <><strong>{actor}</strong> removed you from a group</>;
  return <><strong>{actor}</strong> sent a notification</>;
}

export default function NotificationsMenu({ open, onToggle, onClose }) {
  const { notifications, unreadNotifications, markNotificationsRead } = useChat();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event) => {
      if (panelRef.current && !panelRef.current.contains(event.target)) onClose();
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, onClose]);

  async function openNotification(notification) {
    await markNotificationsRead({ ids: [notification.id] });
    onClose();
    if (notification.type === 'message' || notification.type === 'group_add' || notification.type === 'group_remove') {
      if (notification.conversationId) navigate(`/?c=${notification.conversationId}`);
      return;
    }
    if (notification.type === 'friend_request') {
      navigate('/friends?tab=requests');
      return;
    }
    if (notification.type === 'friend_accepted') {
      navigate('/friends');
      return;
    }
    if (notification.type === 'missed_call') {
      navigate('/calls');
      return;
    }
    if (notification.type === 'system' && isAdmin && notification.payload?.reportId) {
      navigate('/admin?tab=reports');
    }
  }

  async function markAll() {
    setBusy(true);
    try {
      await markNotificationsRead({ all: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notif-wrap" ref={panelRef}>
      <IconButton
        label="Notifications"
        icon={unreadNotifications ? BellRing : Bell}
        badge={unreadNotifications}
        onClick={onToggle}
        aria-expanded={open}
        className={open ? 'is-active' : ''}
      />
      {open ? (
        <div className="notif-panel">
          <div className="notif-head">
            <strong>Notifications</strong>
            <div className="notif-head-actions">
              <button type="button" className="notif-action" onClick={markAll} disabled={busy || !unreadNotifications}>
                <CheckCheck size={14} /> Mark all read
              </button>
              <IconButton label="Close notifications" icon={X} size={16} onClick={onClose} />
            </div>
          </div>
          <div className="notif-list">
            {notifications.length === 0 ? (
              <div className="notif-empty">
                <Bell size={22} />
                <p>You're all caught up.</p>
              </div>
            ) : (
              notifications.map((notification) => {
                const Icon = iconFor(notification.type);
                return (
                  <button
                    type="button"
                    key={notification.id}
                    className={`notif-item ${notification.readAt ? '' : 'is-unread'}`}
                    onClick={() => openNotification(notification)}
                  >
                    <span className="notif-icon">
                      <Icon size={16} />
                    </span>
                    <span className="notif-body">
                      <span className="notif-text">{textFor(notification)}</span>
                      <span className="notif-time">{timeAgo(notification.createdAt)}</span>
                    </span>
                    {!notification.readAt ? <span className="notif-dot" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
