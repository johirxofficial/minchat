import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Compass, MessageCircle } from 'lucide-react';
import { Button } from '../components/ui';
import { useAuth } from '../context/AuthContext';

export default function NotFoundPage() {
  const { me } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="notfound-page">
      <div className="notfound-card">
        <span className="notfound-code" aria-hidden="true">
          404
        </span>
        <h1>This page wandered off</h1>
        <p>
          The link may be old, mistyped, or the page may have moved. Your conversations are still
          exactly where you left them.
        </p>
        <div className="notfound-actions">
          <Button icon={MessageCircle} onClick={() => navigate(me ? '/' : '/login')}>
            {me ? 'Back to chats' : 'Go to sign in'}
          </Button>
          {me ? (
            <Link to="/discover" className="btn btn-secondary btn-md">
              <Compass size={16} />
              <span>Discover people</span>
            </Link>
          ) : (
            <Link to="/register" className="btn btn-secondary btn-md">
              <ArrowLeft size={16} />
              <span>Create an account</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
