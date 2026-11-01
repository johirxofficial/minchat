import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, MessageSquareText, Loader2 } from 'lucide-react';
import { Modal } from './ui';
import { endpoints } from '../lib/api';
import { debounce, timeAgo, truncate } from '../lib/utils';

export default function SearchModal({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const debounced = useRef(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setError('');
    }
  }, [open]);

  useEffect(() => {
    debounced.current = debounce(async (value) => {
      if (value.trim().length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const data = await endpoints.searchMessages(value.trim());
        setResults(data.results || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => debounced.current?.cancel();
  }, []);

  function update(value) {
    setQuery(value);
    setLoading(value.trim().length >= 2);
    debounced.current?.(value);
  }

  function openResult(result) {
    onClose();
    navigate(`/?c=${result.conversationId}`);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Search messages"
      description="Find anything you've sent or received in your conversations."
      size="md"
    >
      <div className="search-box">
        <Search size={18} />
        <input
          autoFocus
          value={query}
          onChange={(event) => update(event.target.value)}
          placeholder="Search for a word or phrase…"
          aria-label="Search messages"
        />
        {query ? (
          <button type="button" className="input-action" onClick={() => update('')} aria-label="Clear search">
            <X size={16} />
          </button>
        ) : null}
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="search-results">
        {loading ? (
          <div className="search-state">
            <Loader2 size={18} className="spin" /> Searching…
          </div>
        ) : query.trim().length < 2 ? (
          <div className="search-hint">
            <MessageSquareText size={24} />
            <p>Type at least two characters to search your message history.</p>
          </div>
        ) : results.length === 0 ? (
          <div className="search-hint">
            <p>No messages matched “{query.trim()}”.</p>
          </div>
        ) : (
          results.map((result) => (
            <button key={result.id} type="button" className="search-result" onClick={() => openResult(result)}>
              <div className="search-result-top">
                <strong>
                  {result.conversationType === 'group'
                    ? result.conversationName || 'Group'
                    : result.sender?.displayName || result.sender?.username || 'Conversation'}
                </strong>
                <span>{timeAgo(result.createdAt)}</span>
              </div>
              <p>{truncate(result.body || '(attachment)', 160)}</p>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
