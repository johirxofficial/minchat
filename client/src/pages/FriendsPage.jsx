import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Check,
  MessageCircle,
  Search,
  UserMinus,
  UserPlus,
  UserRound,
  Users2,
  X,
  Ban
} from 'lucide-react';
import { Avatar, Button, ConfirmDialog, EmptyState, Field, Modal, Segmented, Spinner } from '../components/ui';
import { endpoints } from '../lib/api';
import { useChat } from '../context/ChatContext';
import { useToast } from '../context/ToastContext';
import { timeAgo } from '../lib/utils';

export default function FriendsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'requests' ? 'requests' : params.get('tab') === 'blocked' ? 'blocked' : 'friends';
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [requestTab, setRequestTab] = useState('incoming');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const { startDirect } = useChat();

  const load = useCallback(async () => {
    try {
      const [friendData, incomingData, outgoingData, blockData] = await Promise.all([
        endpoints.friends(),
        endpoints.friendRequests('incoming'),
        endpoints.friendRequests('outgoing'),
        endpoints.blocks()
      ]);
      setFriends(friendData.friends || []);
      setIncoming(incomingData.requests || []);
      setOutgoing(outgoingData.requests || []);
      setBlocks(blockData.blocks || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener('minchat:friends-changed', onChange);
    return () => window.removeEventListener('minchat:friends-changed', onChange);
  }, [load]);

  function changeTab(value) {
    const next = new URLSearchParams(params);
    if (value === 'friends') next.delete('tab');
    else next.set('tab', value);
    setParams(next, { replace: true });
  }

  async function respond(id, action) {
    setBusy(true);
    try {
      await endpoints.respondRequest(id, action);
      toast.success(action === 'accept' ? 'Friend request accepted' : 'Request declined');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest(id) {
    setBusy(true);
    try {
      await endpoints.respondRequest(id, 'cancel');
      toast.info('Request cancelled');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function messageFriend(friend) {
    try {
      const conversation = await startDirect(friend.id);
      navigate(`/?c=${conversation.id}`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.type === 'unfriend') {
        await endpoints.removeFriend(confirm.id);
        toast.success('Friend removed');
      }
      if (confirm.type === 'unblock') {
        await endpoints.unblock(confirm.id);
        toast.success('User unblocked');
      }
      setConfirm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Friends</h1>
          <p>Your people, requests, and blocks — all in one place.</p>
        </div>
        <Button icon={UserPlus} onClick={() => setAddOpen(true)}>
          Add friend
        </Button>
      </header>

      <Segmented
        ariaLabel="Friends sections"
        value={tab}
        onChange={changeTab}
        options={[
          { value: 'friends', label: 'Friends', count: friends.length },
          { value: 'requests', label: 'Requests', count: incoming.length },
          { value: 'blocked', label: 'Blocked', count: blocks.length }
        ]}
      />

      {loading ? (
        <div className="page-loading">
          <Spinner size={22} /> Loading your friends…
        </div>
      ) : tab === 'friends' ? (
        friends.length === 0 ? (
          <EmptyState
            icon={Users2}
            title="No friends yet"
            description="Search for someone by name or username and send a friendly request."
          >
            <Button icon={UserPlus} onClick={() => setAddOpen(true)}>
              Find your first friend
            </Button>
          </EmptyState>
        ) : (
          <div className="people-grid">
            {friends.map((friend) => (
              <article className="person-card" key={friend.id}>
                <div className="person-card-top">
                  <Avatar name={friend.displayName} src={friend.avatarUrl} size={56} online={friend.online} />
                  <div className="person-card-copy">
                    <h3>{friend.displayName}</h3>
                    <span>@{friend.username}</span>
                    <em>
                      {friend.online
                        ? 'Online now'
                        : friend.lastActiveAt
                          ? `Active ${timeAgo(friend.lastActiveAt)}`
                          : 'Offline'}
                    </em>
                  </div>
                </div>
                <div className="person-card-actions">
                  <Button size="sm" icon={MessageCircle} onClick={() => messageFriend(friend)}>
                    Message
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={UserMinus}
                    onClick={() =>
                      setConfirm({
                        type: 'unfriend',
                        id: friend.id,
                        title: `Remove ${friend.displayName}?`,
                        description: 'You will no longer be able to message or call each other.',
                        label: 'Remove friend'
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )
      ) : tab === 'requests' ? (
        <div className="requests-wrap">
          <div className="subtabs">
            <button type="button" className={requestTab === 'incoming' ? 'is-active' : ''} onClick={() => setRequestTab('incoming')}>
              Incoming {incoming.length ? <span>{incoming.length}</span> : null}
            </button>
            <button type="button" className={requestTab === 'outgoing' ? 'is-active' : ''} onClick={() => setRequestTab('outgoing')}>
              Sent {outgoing.length ? <span>{outgoing.length}</span> : null}
            </button>
          </div>

          {requestTab === 'incoming' ? (
            incoming.length === 0 ? (
              <EmptyState icon={UserPlus} title="No incoming requests" description="When someone asks to be friends, it will appear here." compact />
            ) : (
              <div className="request-list">
                {incoming.map((request) => (
                  <article className="request-card" key={request.id}>
                    <Avatar name={request.user.displayName} src={request.user.avatarUrl} size={46} />
                    <div className="request-copy">
                      <h3>{request.user.displayName}</h3>
                      <span>@{request.user.username} · {timeAgo(request.createdAt)}</span>
                      {request.message ? <p>“{request.message}”</p> : null}
                    </div>
                    <div className="request-actions">
                      <Button size="sm" icon={Check} loading={busy} onClick={() => respond(request.id, 'accept')}>
                        Accept
                      </Button>
                      <Button size="sm" variant="ghost" icon={X} loading={busy} onClick={() => respond(request.id, 'reject')}>
                        Decline
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )
          ) : outgoing.length === 0 ? (
            <EmptyState icon={UserPlus} title="No sent requests" description="Requests you send will appear here until they are answered." compact />
          ) : (
            <div className="request-list">
              {outgoing.map((request) => (
                <article className="request-card" key={request.id}>
                  <Avatar name={request.user.displayName} src={request.user.avatarUrl} size={46} />
                  <div className="request-copy">
                    <h3>{request.user.displayName}</h3>
                    <span>@{request.user.username} · sent {timeAgo(request.createdAt)}</span>
                  </div>
                  <div className="request-actions">
                    <Button size="sm" variant="ghost" loading={busy} onClick={() => cancelRequest(request.id)}>
                      Cancel request
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : blocks.length === 0 ? (
        <EmptyState icon={Ban} title="No blocked users" description="Blocking someone removes your friendship and stops contact in both directions." compact />
      ) : (
        <div className="request-list">
          {blocks.map((block) => (
            <article className="request-card" key={block.user.id}>
              <Avatar name={block.user.displayName} src={block.user.avatarUrl} size={46} />
              <div className="request-copy">
                <h3>{block.user.displayName}</h3>
                <span>@{block.user.username} · blocked {timeAgo(block.blockedAt)}</span>
              </div>
              <div className="request-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setConfirm({
                      type: 'unblock',
                      id: block.user.id,
                      title: `Unblock ${block.user.displayName}?`,
                      description: 'You will be able to see each other in search again. They will not be re-added as a friend automatically.',
                      label: 'Unblock'
                    })
                  }
                >
                  Unblock
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <AddFriendModal open={addOpen} onClose={() => setAddOpen(false)} onSent={load} />

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        loading={busy}
        tone={confirm?.type === 'unfriend' ? 'danger' : 'primary'}
        title={confirm?.title}
        description={confirm?.description}
        confirmLabel={confirm?.label}
      />
    </div>
  );
}

function AddFriendModal({ open, onClose, onSent }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState({});
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setError('');
      setSent({});
    }
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      setError('');
      try {
        const data = await endpoints.searchUsers(query.trim());
        if (alive) setResults(data.results || []);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setSearching(false);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, open]);

  async function add(user) {
    try {
      await endpoints.sendFriendRequest({ userId: user.id });
      setSent((prev) => ({ ...prev, [user.id]: true }));
      toast.success(`Friend request sent to ${user.displayName}`);
      onSent?.();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a friend"
      description="Search by display name or @username. Requests must be accepted before you can chat."
      size="md"
    >
      <div className="search-box">
        <Search size={18} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people…"
          aria-label="Search people"
        />
        {searching ? <Spinner size={16} /> : null}
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="pick-list">
        {query.trim().length < 2 ? (
          <div className="search-hint">
            <UserRound size={24} />
            <p>Type at least two characters to find people.</p>
          </div>
        ) : results.length === 0 && !searching ? (
          <p className="pick-empty">No one matched “{query.trim()}”.</p>
        ) : (
          results.map((person) => (
            <div className="pick-row is-static" key={person.id}>
              <Avatar name={person.displayName} src={person.avatarUrl} size={42} />
              <span className="pick-copy">
                <strong>{person.displayName}</strong>
                <span>
                  @{person.username}
                  {person.bio ? ` · ${person.bio}` : ''}
                </span>
              </span>
              {person.isFriend ? (
                <Button size="sm" variant="secondary" icon={MessageCircle} onClick={async () => {
                  try {
                    const conversation = await setDirect(person);
                    onClose();
                    navigate(`/?c=${conversation.id}`);
                  } catch (err) {
                    toast.error(err.message);
                  }
                }}>
                  Message
                </Button>
              ) : person.relationship === 'outgoing' || sent[person.id] ? (
                <span className="pick-status">Requested</span>
              ) : person.relationship === 'incoming' ? (
                <Button size="sm" variant="secondary" onClick={() => { onClose(); navigate('/friends?tab=requests'); }}>
                  Respond
                </Button>
              ) : (
                <Button size="sm" icon={UserPlus} onClick={() => add(person)}>
                  Add
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

// Small helper so the modal can start a direct chat without another hook.
async function setDirect(person) {
  const { conversation } = await endpoints.direct(person.id);
  return conversation;
}
