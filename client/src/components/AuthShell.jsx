import { Link } from 'react-router-dom';
import { ShieldCheck, Sparkles, MessagesSquare, Lock } from 'lucide-react';

export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="auth-page">
      <aside className="auth-visual" aria-hidden="true">
        <div className="auth-visual-glow" />
        <div className="auth-brand">
          <span className="brand-mark">m</span>
          <span className="auth-brand-text">
            MinChat
            <small>by johirxofficial</small>
          </span>
        </div>

        <div className="auth-pitch">
          <h1>
            Quiet conversations.
            <br />
            <em>Real connection.</em>
          </h1>
          <p>
            A calm, privacy-aware messenger for the people you actually want to talk to — with
            voice, video, groups and thoughtful controls.
          </p>
          <ul className="auth-points">
            <li>
              <MessagesSquare size={17} />
              <span>One-to-one and group conversations with receipts, replies and reactions.</span>
            </li>
            <li>
              <Lock size={17} />
              <span>Your media lives behind authenticated access — never in a public folder.</span>
            </li>
            <li>
              <ShieldCheck size={17} />
              <span>Only friends can message or call. Blocking is enforced on the server.</span>
            </li>
          </ul>
        </div>

        <div className="auth-bubbles">
          <div className="auth-bubble auth-bubble-a">
            <span className="auth-bubble-dot" /> Hey — are we still on for tonight?
          </div>
          <div className="auth-bubble auth-bubble-b">Absolutely. I&apos;ll bring the playlist 🎧</div>
          <div className="auth-bubble auth-bubble-c">
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>Maya is typing…</span>
          </div>
        </div>

        <div className="auth-footnote">
          <Sparkles size={14} /> Built with care. No ads, no trackers, no noise.
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-mobile-brand">
          <span className="brand-mark brand-mark-sm">m</span>
          <span>MinChat</span>
        </div>
        <div className="auth-card">
          <header className="auth-heading">
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </header>
          {children}
          {footer ? <footer className="auth-footer">{footer}</footer> : null}
        </div>
        <p className="auth-legal">
          By continuing you agree to treat people kindly. MinChat is open-source software by
          johirxofficial.
        </p>
      </main>
    </div>
  );
}

export function AuthLink({ to, children }) {
  return (
    <Link to={to} className="text-link">
      {children}
    </Link>
  );
}
