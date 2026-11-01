import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Megaphone, Pin, ShieldAlert, X } from 'lucide-react';
import { endpoints } from '../lib/api';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { timeAgo } from '../lib/utils';

const LEVEL_META = {
  info: { icon: Info, tone: 'info' },
  success: { icon: CheckCircle2, tone: 'success' },
  warning: { icon: AlertTriangle, tone: 'warning' },
  critical: { icon: ShieldAlert, tone: 'critical' }
};

/**
 * Admin announcements pinned above the conversation list. Notices are loaded
 * from the API and kept in sync over the realtime socket so publishing or
 * archiving is reflected without a refresh.
 */
export default function NoticeBanner() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const toast = useToast();
  const [notices, setNotices] = useState([]);
  const [dismissing, setDismissing] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await endpoints.notices();
      setNotices(data.notices || []);
    } catch {
      // Notices are supplementary; never block chat on a failed fetch.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, user?.role]);

  useEffect(() => {
    const onChange = () => load();
    window.addEventListener('minchat:notices-changed', onChange);
    window.addEventListener('focus', onChange);
    return () => {
      window.removeEventListener('minchat:notices-changed', onChange);
      window.removeEventListener('focus', onChange);
    };
  }, [load]);

  useEffect(() => {
    if (!socket) return undefined;
    const onNew = (notice) => {
      setNotices((current) => {
        if (current.some((item) => item.id === notice.id)) return current;
        return [notice, ...current].slice(0, 6);
      });
    };
    const onUpdate = () => load();
    const onRemoved = ({ id }) => setNotices((current) => current.filter((item) => item.id !== id));
    socket.on('notice:new', onNew);
    socket.on('notice:update', onUpdate);
    socket.on('notice:removed', onRemoved);
    return () => {
      socket.off('notice:new', onNew);
      socket.off('notice:update', onUpdate);
      socket.off('notice:removed', onRemoved);
    };
  }, [socket, load]);

  async function dismiss(notice) {
    setDismissing(notice.id);
    try {
      const result = await endpoints.dismissNotice(notice.id);
      if (result.dismissed) {
        setNotices((current) => current.filter((item) => item.id !== notice.id));
        toast.info('Announcement dismissed');
      } else {
        toast.info('This announcement stays pinned');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDismissing(null);
    }
  }

  if (!notices.length) return null;

  return (
    <div className="notice-stack" aria-label="Announcements">
      {notices.map((notice) => {
        const meta = LEVEL_META[notice.level] || LEVEL_META.info;
        const Icon = meta.icon;
        return (
          <article className={`notice-card notice-${notice.level}`} key={notice.id} role="status">
            <span className="notice-icon">
              <Icon size={17} />
            </span>
            <div className="notice-copy">
              <div className="notice-title">
                <strong>{notice.title}</strong>
                {notice.pinned ? (
                  <span className="notice-pin" title="Pinned">
                    <Pin size={12} /> Pinned
                  </span>
                ) : null}
              </div>
              <p>{notice.body}</p>
              <span className="notice-meta">
                {notice.author?.displayName ? `From ${notice.author.displayName}` : 'MinChat team'} ·{' '}
                {timeAgo(notice.startsAt || notice.createdAt)}
              </span>
            </div>
            {notice.dismissible ? (
              <button
                type="button"
                className="notice-dismiss"
                onClick={() => dismiss(notice)}
                disabled={dismissing === notice.id}
                aria-label={`Dismiss ${notice.title}`}
              >
                <X size={15} />
              </button>
            ) : (
              <span className="notice-permanent" title="This announcement cannot be dismissed">
                <Megaphone size={14} />
              </span>
            )}
          </article>
        );
      })}
    </div>
  );
}
