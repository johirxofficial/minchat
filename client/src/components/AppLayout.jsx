import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Compass,
  LogOut,
  MessageCircle,
  Phone,
  Search,
  Settings,
  ShieldCheck,
  Users2,
  Wrench
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { useSocket } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import { endpoints } from '../lib/api';
import { Avatar, IconButton } from './ui';
import NotificationsMenu from './NotificationsMenu';
import SearchModal from './SearchModal';
import CallOverlay from './CallOverlay';

function useMaintenance() {
  const [state, setState] = useState({ active: false, message: null });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await fetch('/api/health', { credentials: 'same-origin' }).then((res) => res.json());
        if (alive && data?.maintenance) setState(data.maintenance);
      } catch {
        // Health probe failures are not maintenance; keep the app usable.
      }
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return state;
}

function MaintenanceScreen({ message }) {
  return (
    <div className="maintenance-screen">
      <div className="maintenance-card">
        <span className="maintenance-icon">
          <Wrench size={26} />
        </span>
        <h1>We’ll be right back</h1>
        <p>{message || 'MinChat is getting a quick tune-up. Please check back shortly.'}</p>
        <small>Your conversations and files are safe. This page refreshes automatically.</small>
      </div>
    </div>
  );
}

function useFriendBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await endpoints.friendRequests('incoming');
        if (alive) setCount((data.requests || []).length);
      } catch {
        // Badge is cosmetic.
      }
    };
    load();
    const onChange = () => load();
    window.addEventListener('minchat:friends-changed', onChange);
    window.addEventListener('focus', onChange);
    const timer = setInterval(load, 90_000);
    return () => {
      alive = false;
      window.removeEventListener('minchat:friends-changed', onChange);
      window.removeEventListener('focus', onChange);
      clearInterval(timer);
    };
  }, []);
  return count;
}

function RailLink({ to, icon: Icon, label, badge, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `rail-link ${isActive ? 'is-active' : ''}`}
      title={label}
      aria-label={label}
    >
      <span className="rail-icon">
        <Icon size={21} />
        {badge ? <span className="rail-badge">{badge > 99 ? '99+' : badge}</span> : null}
      </span>
      <span className="rail-label">{label}</span>
    </NavLink>
  );
}

export default function AppLayout() {
  const { me, user, can, logout } = useAuth();
  const { unreadChats } = useChat();
  const { connected } = useSocket();
  const toast = useToast();
  const navigate = useNavigate();
  const requestCount = useFriendBadge();
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const maintenance = useMaintenance();
  const staff = can('console.access');

  useEffect(() => {
    const openSearch = () => setSearchOpen(true);
    window.addEventListener('minchat:open-search', openSearch);
    return () => window.removeEventListener('minchat:open-search', openSearch);
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function onLogout() {
    await logout();
    toast.info('Signed out');
    navigate('/login', { replace: true });
  }

  if (maintenance.active && !staff) {
    return <MaintenanceScreen message={maintenance.message} />;
  }

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Primary navigation">
        <div className="rail-top">
          <NavLink to="/" className="rail-logo" aria-label="MinChat home">
            <span className="brand-mark">m</span>
          </NavLink>
          <span
            className={`rail-connection ${connected ? 'is-online' : 'is-offline'}`}
            title={connected ? 'Realtime connected' : 'Reconnecting…'}
            aria-label={connected ? 'Realtime connected' : 'Reconnecting'}
          />
        </div>

        <nav className="rail-nav">
          <RailLink to="/" end icon={MessageCircle} label="Chats" badge={unreadChats} />
          <RailLink to="/friends" icon={Users2} label="Friends" badge={requestCount} />
          <RailLink to="/discover" icon={Compass} label="Discover" />
          <RailLink to="/calls" icon={Phone} label="Calls" />
        </nav>

        <div className="rail-tools">
          <IconButton
            label="Search messages (Ctrl K)"
            icon={Search}
            onClick={() => setSearchOpen(true)}
          />
          {staff ? <RailLink to="/admin" icon={ShieldCheck} label="Console" /> : null}
          <NotificationsMenu
            open={notifOpen}
            onToggle={() => setNotifOpen((value) => !value)}
            onClose={() => setNotifOpen(false)}
          />
          <RailLink to="/settings" icon={Settings} label="Settings" />
        </div>

        <div className="rail-profile">
          <NavLink to="/settings" className="rail-avatar" title={`${user?.displayName} — profile settings`}>
            <Avatar name={user?.displayName || user?.username} src={user?.avatarUrl} size={36} online />
          </NavLink>
          <IconButton label="Sign out" icon={LogOut} onClick={onLogout} className="rail-logout" />
        </div>
      </aside>

      <main className="app-main">
        <Outlet context={{ openSearch: () => setSearchOpen(true) }} />
      </main>

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <CallOverlay />
      <span className="app-version" aria-hidden="true">MinChat</span>
      {me ? null : null}
    </div>
  );
}
