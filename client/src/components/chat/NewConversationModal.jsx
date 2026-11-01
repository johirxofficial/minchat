import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Search, UserRound, Users2 } from 'lucide-react';
import { Avatar, Button, EmptyState, Modal, Segmented, Spinner } from '../ui';
import { endpoints } from '../../lib/api';
import { useChat } from '../../context/ChatContext';
import { useToast } from '../../context/ToastContext';

export default function NewConversationModal({ open, onClose, onCreated }) {
  const { startDirect, createGroup } = useChat();
  const toast = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState('direct');
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setMode('direct');
      setSearch('');
      setSelected([]);
      setName('');
      setError('');
      setBusy(false);
      return;
    }
    let alive = true;
    setLoading(true);
    endpoints
      .friends()
      .then((data) => {
        if (alive) setFriends(data.friends || []);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (friend) =>
        friend.displayName?.toLowerCase().includes(q) || friend.username?.toLowerCase().includes(q)
    );
  }, [friends, search]);

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function start(friend) {
    setBusy(true);
    setError('');
    try {
      const conversation = await startDirect(friend.id);
      onClose();
      onCreated(conversation.id);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function create(event) {
    event.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Give your group a name');
      return;
    }
    if (!selected.length) {
      setError('Choose at least one friend');
      return;
    }
    setBusy(true);
    try {
      const conversation = await createGroup(name.trim(), selected);
      onClose();
      onCreated(conversation.id);
      toast.success('Group created');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New conversation"
      description="Start a private chat or gather a few friends into a group."
      size="md"
      footer={
        mode === 'group' ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={create} loading={busy} icon={Users2} disabled={!selected.length || !name.trim()}>
              Create group ({selected.length + 1})
            </Button>
          </>
        ) : null
      }
    >
      <Segmented
        ariaLabel="Conversation type"
        value={mode}
        onChange={(value) => {
          setMode(value);
          setError('');
        }}
        options={[
          { value: 'direct', label: 'Direct message' },
          { value: 'group', label: 'New group' }
        ]}
      />

      {mode === 'group' ? (
        <div className="field" style={{ marginTop: 16 }}>
          <span className="field-label">Group name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Weekend plans"
            maxLength={80}
            autoFocus
          />
        </div>
      ) : null}

      <div className="panel-search" style={{ marginTop: 14 }}>
        <Search size={16} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search your friends"
          aria-label="Search friends"
        />
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="pick-list">
        {loading ? (
          <div className="pick-loading">
            <Spinner size={18} /> Loading friends…
          </div>
        ) : friends.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title="No friends yet"
            description="Find someone in Discover, send a friend request, and they’ll appear here once accepted."
            compact
          >
            <Button
              size="sm"
              onClick={() => {
                onClose();
                navigate('/discover');
              }}
            >
              Find people
            </Button>
          </EmptyState>
        ) : filtered.length === 0 ? (
          <p className="pick-empty">No friends match “{search}”.</p>
        ) : (
          filtered.map((friend) => {
            const isSelected = selected.includes(friend.id);
            return (
              <button
                type="button"
                key={friend.id}
                className={`pick-row ${isSelected ? 'is-selected' : ''}`}
                onClick={() => (mode === 'group' ? toggle(friend.id) : start(friend))}
                disabled={busy}
              >
                <Avatar name={friend.displayName} src={friend.avatarUrl} size={40} online={friend.online} />
                <span className="pick-copy">
                  <strong>{friend.displayName}</strong>
                  <span>@{friend.username}</span>
                </span>
                {mode === 'group' ? (
                  <span className={`pick-check ${isSelected ? 'is-on' : ''}`}>{isSelected ? <Check size={14} /> : null}</span>
                ) : (
                  <span className="pick-action">Message</span>
                )}
              </button>
            );
          })
        )}
      </div>
    </Modal>
  );
}
