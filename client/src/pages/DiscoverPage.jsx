import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  Compass,
  MessageCircle,
  Search,
  UserPlus,
  UserRound,
  Users2
} from 'lucide-react';
import { Avatar, Button, EmptyState, Spinner } from '../components/ui';
import { endpoints } from '../lib/api';
import { useChat } from '../context/ChatContext';
import { useToast } from '../context/ToastContext';

export default function DiscoverPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [friends, setFriends] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState({});
  const { startDirect } = useChat();
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    endpoints
      .friends()
      .then((data) => setFriends((data.friends || []).slice(0, 8)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const data = await endpoints.searchUsers(query.trim());
        if (alive) {
          setResults(data.results || []);
          setError('');
        }
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
  }, [query]);

  async function add(person) {
    try {
      await endpoints.sendFriendRequest({ userId: person.id });
      setSent((prev) => ({ ...prev, [person.id]: true }));
      toast.success(`Friend request sent to ${person.displayName}`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function message(person) {
    try {
      const conversation = await startDirect(person.id);
      navigate(`/?c=${conversation.id}`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  const showingSearch = query.trim().length >= 2;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Discover</h1>
          <p>Find people by name or @username and grow your circle.</p>
        </div>
      </header>

      <section className="discover-hero">
        <div className="discover-hero-copy">
          <span className="discover-eyebrow">
            <Compass size={14} /> People on MinChat
          </span>
          <h2>Good conversations start with a hello.</h2>
          <p>Search for someone you know. Once they accept your request, messaging and calls unlock instantly.</p>
        </div>
        <div className="discover-search">
          <Search size={20} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by display name or @username"
            aria-label="Search people"
            autoFocus
          />
          {searching ? <Spinner size={18} /> : null}
        </div>
      </section>

      {error ? <p className="form-error">{error}</p> : null}

      {showingSearch ? (
        <section className="discover-results">
          <div className="section-head">
            <h3>Results for “{query.trim()}”</h3>
            <span>{results.length} found</span>
          </div>
          {results.length === 0 && !searching ? (
            <EmptyState
              icon={UserRound}
              title="No one found"
              description="Check the spelling, or try searching by username instead."
              compact
            />
          ) : (
            <div className="people-grid">
              {results.map((person) => (
                <article className="person-card" key={person.id}>
                  <div className="person-card-top">
                    <Avatar name={person.displayName} src={person.avatarUrl} size={56} />
                    <div className="person-card-copy">
                      <h3>{person.displayName}</h3>
                      <span>@{person.username}</span>
                      <em>{person.bio || 'No bio yet.'}</em>
                    </div>
                  </div>
                  <div className="person-card-actions">
                    {person.isFriend ? (
                      <>
                        <Button size="sm" icon={MessageCircle} onClick={() => message(person)}>
                          Message
                        </Button>
                        <span className="pick-status">
                          <Check size={13} /> Friends
                        </span>
                      </>
                    ) : sent[person.id] || person.relationship === 'outgoing' ? (
                      <span className="pick-status">Request sent</span>
                    ) : person.relationship === 'incoming' ? (
                      <Button size="sm" variant="secondary" onClick={() => navigate('/friends?tab=requests')}>
                        Respond to request
                      </Button>
                    ) : (
                      <Button size="sm" icon={UserPlus} onClick={() => add(person)}>
                        Add friend
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="discover-suggestions">
          <div className="section-head">
            <h3>
              <Users2 size={17} /> People you already know
            </h3>
            <span>Your friends are a good place to start.</span>
          </div>
          {friends.length === 0 ? (
            <EmptyState
              icon={Compass}
              title="Your circle starts here"
              description="Search above for someone you know. Every friendship begins with one request."
              compact
            />
          ) : (
            <div className="friend-strip">
              {friends.map((friend) => (
                <button type="button" className="friend-chip" key={friend.id} onClick={() => message(friend)}>
                  <Avatar name={friend.displayName} src={friend.avatarUrl} size={44} online={friend.online} />
                  <span>
                    <strong>{friend.displayName}</strong>
                    <em>@{friend.username}</em>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
