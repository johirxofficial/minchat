import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  MessageCircle,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Video
} from 'lucide-react';
import { Avatar, Button, EmptyState, Spinner } from '../components/ui';
import { endpoints } from '../lib/api';
import { useCall } from '../context/CallContext';
import { useToast } from '../context/ToastContext';
import { duration, fullDate, timeAgo } from '../lib/utils';

function statusLabel(call) {
  if (call.status === 'missed') return 'Missed';
  if (call.status === 'rejected') return 'Declined';
  if (call.status === 'cancelled') return 'Cancelled';
  if (call.status === 'ended') return call.durationSeconds ? `Completed · ${duration(call.durationSeconds)}` : 'Completed';
  return call.status;
}

export default function CallsPage() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const { startCall } = useCall();
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    endpoints
      .callHistory()
      .then((data) => {
        if (alive) setCalls(data.calls || []);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [toast]);

  async function callBack(call) {
    setBusyId(call.id);
    try {
      const { conversation } = await endpoints.conversation(call.conversationId);
      if (!conversation.canSend) {
        toast.info('You can only call friends. Re-add each other first.');
        return;
      }
      await startCall(conversation, call.type);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Calls</h1>
          <p>Your voice and video history. Calls are only available between friends.</p>
        </div>
      </header>

      {loading ? (
        <div className="page-loading">
          <Spinner size={22} /> Loading call history…
        </div>
      ) : calls.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title="No calls yet"
          description="Open a conversation with a friend and use the phone or video button to start your first call."
        >
          <Button icon={MessageCircle} onClick={() => navigate('/')}>
            Go to chats
          </Button>
        </EmptyState>
      ) : (
        <div className="call-history">
          {calls.map((call) => {
            const outgoing = call.direction === 'outgoing';
            const missed = call.status === 'missed';
            const Icon = missed ? PhoneMissed : outgoing ? PhoneOutgoing : PhoneIncoming;
            return (
              <article className={`call-row ${missed ? 'is-missed' : ''}`} key={call.id}>
                <span className={`call-row-icon ${missed ? 'is-missed' : outgoing ? 'is-outgoing' : 'is-incoming'}`}>
                  <Icon size={17} />
                </span>
                <Avatar name={call.otherUser?.displayName} src={call.otherUser?.avatarUrl} size={46} />
                <div className="call-row-copy">
                  <h3>{call.otherUser?.displayName || 'Unknown'}</h3>
                  <span>
                    {call.type === 'video' ? <Video size={12} /> : <Phone size={12} />}
                    {outgoing ? 'Outgoing' : 'Incoming'} · {statusLabel(call)} · {timeAgo(call.startedAt)}
                  </span>
                  <em>{fullDate(call.startedAt)}</em>
                </div>
                <div className="call-row-actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={call.type === 'video' ? Video : Phone}
                    loading={busyId === call.id}
                    onClick={() => callBack(call)}
                  >
                    Call back
                  </Button>
                  <Button size="sm" variant="ghost" icon={MessageCircle} onClick={() => navigate(`/?c=${call.conversationId}`)}>
                    Chat
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="calls-note">
        <Clock size={14} /> Call history is kept for both participants. MinChat does not record call
        audio or video.
      </p>
    </div>
  );
}
