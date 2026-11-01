import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BellOff,
  BellRing,
  Camera,
  Check,
  Flag,
  LogOut,
  Pencil,
  Shield,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users2,
  X,
  Ban,
  Crown
} from 'lucide-react';
import { Avatar, Button, ConfirmDialog, Field, IconButton, Modal, Spinner } from '../ui';
import { endpoints } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { conversationAvatar, conversationName, fullDate, timeAgo } from '../../lib/utils';

const REPORT_REASONS = [
  ['spam', 'Spam or unwanted messages'],
  ['harassment', 'Harassment or bullying'],
  ['impersonation', 'Impersonation'],
  ['inappropriate_media', 'Inappropriate media'],
  ['scam', 'Scam or fraud'],
  ['other', 'Something else']
];

function muteValue(conversation) {
  if (conversation?.notificationLevel === 'none') return 'forever';
  if (!conversation?.mutedUntil) return 'off';
  return 'custom';
}

export default function ConversationDetails({ conversation, onClose, onChanged, onLeft, onBlocked }) {
  const { user } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [friends, setFriends] = useState([]);
  const [selected, setSelected] = useState([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('spam');
  const [reportDetails, setReportDetails] = useState('');
  const [muteOpen, setMuteOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInput = useRef(null);

  const isGroup = conversation?.type === 'group';
  const other = conversation?.otherUser || conversation?.members?.find((m) => m.id !== user?.id);
  const name = conversationName(conversation, user?.id);
  const amAdmin = isGroup && conversation?.myRole === 'admin';

  useEffect(() => {
    setProfile(null);
    if (!other?.username) return undefined;
    let alive = true;
    endpoints
      .profile(other.username)
      .then((data) => {
        if (alive) setProfile(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [other?.username]);

  const nonMembers = useMemo(() => {
    const memberIds = new Set((conversation?.members || []).map((m) => m.id));
    return friends.filter((friend) => !memberIds.has(friend.id));
  }, [friends, conversation?.members]);

  async function setMute(choice) {
    setMuteOpen(false);
    const now = Date.now();
    let mutedUntil = null;
    if (choice === '1h') mutedUntil = new Date(now + 3600_000).toISOString();
    if (choice === '8h') mutedUntil = new Date(now + 8 * 3600_000).toISOString();
    if (choice === '1w') mutedUntil = new Date(now + 7 * 86400_000).toISOString();
    if (choice === 'forever') mutedUntil = new Date(now + 365 * 86400_000).toISOString();
    setBusy(true);
    try {
      await endpoints.conversationSettings(conversation.id, { mutedUntil });
      await onChanged?.();
      toast.success(mutedUntil ? 'Notifications muted' : 'Notifications restored');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    if (!renameValue.trim()) return;
    setBusy(true);
    try {
      await endpoints.updateGroup(conversation.id, renameValue.trim());
      await onChanged?.();
      setRenameOpen(false);
      toast.success('Group renamed');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(file) {
    if (!file) return;
    setAvatarBusy(true);
    try {
      await endpoints.uploadGroupAvatar(conversation.id, file);
      await onChanged?.();
      toast.success('Group photo updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function openAddMembers() {
    setAddOpen(true);
    try {
      const data = await endpoints.friends();
      setFriends(data.friends || []);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function addMembers() {
    if (!selected.length) return;
    setBusy(true);
    try {
      await endpoints.groupMembers(conversation.id, selected);
      setAddOpen(false);
      setSelected([]);
      await onChanged?.();
      toast.success('Members added');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.type === 'removeFriend') {
        await endpoints.removeFriend(other.id);
        await onChanged?.();
        toast.success('Friend removed');
      }
      if (confirm.type === 'block') {
        await endpoints.block(other.id);
        toast.success(`${other.displayName} was blocked`);
        onBlocked?.();
      }
      if (confirm.type === 'leave') {
        await endpoints.leaveGroup(conversation.id);
        toast.success('You left the group');
        onLeft?.();
      }
      if (confirm.type === 'removeMember') {
        await endpoints.removeGroupMember(conversation.id, confirm.memberId);
        await onChanged?.();
        toast.success('Member removed');
      }
      if (confirm.type === 'promote') {
        await endpoints.setMemberRole(conversation.id, confirm.memberId, 'admin');
        await onChanged?.();
        toast.success('Member promoted to admin');
      }
      if (confirm.type === 'demote') {
        await endpoints.setMemberRole(conversation.id, confirm.memberId, 'member');
        await onChanged?.();
        toast.success('Admin role removed');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function submitReport(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await endpoints.report({
        userId: other.id,
        reason: reportReason,
        details: reportDetails.trim(),
        conversationId: conversation.id
      });
      setReportOpen(false);
      setReportDetails('');
      toast.success('Report submitted. Thank you for helping keep MinChat safe.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!conversation) return null;

  return (
    <aside className="details-panel" aria-label="Conversation details">
      <header className="details-head">
        <h2>{isGroup ? 'Group info' : 'Contact info'}</h2>
        <IconButton label="Close details" icon={X} onClick={onClose} />
      </header>

      <div className="details-scroll">
        <div className="details-hero">
          <div className="details-avatar">
            <Avatar
              name={name}
              src={conversationAvatar(conversation)}
              size={96}
              square={isGroup}
              online={isGroup ? null : other?.online}
            />
            {isGroup && amAdmin ? (
              <>
                <button
                  type="button"
                  className="details-avatar-edit"
                  onClick={() => avatarInput.current?.click()}
                  disabled={avatarBusy}
                  aria-label="Change group photo"
                >
                  {avatarBusy ? <Spinner size={15} /> : <Camera size={15} />}
                </button>
                <input
                  ref={avatarInput}
                  type="file"
                  hidden
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(event) => {
                    uploadAvatar(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              </>
            ) : null}
          </div>
          <h3>{name}</h3>
          {isGroup ? (
            <p>
              <Users2 size={14} /> {conversation.members?.length || 0} members
            </p>
          ) : (
            <p className="details-handle">@{other?.username}</p>
          )}
          {!isGroup && other ? (
            <p className="details-presence">
              {profile?.presence?.online
                ? 'Online now'
                : profile?.presence?.lastActiveAt
                  ? `Last active ${timeAgo(profile.presence.lastActiveAt)}`
                  : 'Offline'}
            </p>
          ) : null}
        </div>

        {isGroup ? (
          <div className="details-actions">
            <button type="button" onClick={() => { setRenameValue(conversation.name || ''); setRenameOpen(true); }} disabled={!amAdmin}>
              <span className="details-action-icon"><Pencil size={17} /></span>
              <span>Rename</span>
            </button>
            <button type="button" onClick={openAddMembers} disabled={!amAdmin}>
              <span className="details-action-icon"><UserPlus size={17} /></span>
              <span>Add</span>
            </button>
            <button type="button" onClick={() => setMuteOpen(true)}>
              <span className="details-action-icon">
                {conversation.mutedUntil && new Date(conversation.mutedUntil) > new Date() ? <BellOff size={17} /> : <BellRing size={17} />}
              </span>
              <span>Mute</span>
            </button>
            <button type="button" className="is-danger" onClick={() => setConfirm({ type: 'leave', title: 'Leave this group?', description: 'You will stop receiving messages from this group. You can be added again later.', confirmLabel: 'Leave group' })}>
              <span className="details-action-icon"><LogOut size={17} /></span>
              <span>Leave</span>
            </button>
          </div>
        ) : (
          <div className="details-actions">
            <button type="button" onClick={() => setMuteOpen(true)}>
              <span className="details-action-icon">
                {conversation.mutedUntil && new Date(conversation.mutedUntil) > new Date() ? <BellOff size={17} /> : <BellRing size={17} />}
              </span>
              <span>Mute</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirm({ type: 'removeFriend', title: `Remove ${other?.displayName} as a friend?`, description: 'You will no longer be able to message or call each other.', confirmLabel: 'Remove friend' })}
            >
              <span className="details-action-icon"><UserMinus size={17} /></span>
              <span>Unfriend</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirm({ type: 'block', title: `Block ${other?.displayName}?`, description: 'Blocking removes your friendship, cancels pending requests, ends active calls, and prevents new messages or calls in both directions.', confirmLabel: 'Block user' })}
            >
              <span className="details-action-icon"><Ban size={17} /></span>
              <span>Block</span>
            </button>
            <button type="button" className="is-danger" onClick={() => setReportOpen(true)}>
              <span className="details-action-icon"><Flag size={17} /></span>
              <span>Report</span>
            </button>
          </div>
        )}

        {isGroup ? (
          <section className="details-section">
            <h4>Members</h4>
            <div className="member-list">
              {(conversation.members || []).map((member) => {
                const isSelf = member.id === user?.id;
                return (
                  <div className="member-row" key={member.id}>
                    <Avatar name={member.displayName} src={member.avatarUrl} size={38} online={member.online} />
                    <span className="member-copy">
                      <strong>
                        {member.displayName}
                        {isSelf ? ' (you)' : ''}
                      </strong>
                      <span>@{member.username}</span>
                    </span>
                    {member.role === 'admin' ? (
                      <span className="member-role">
                        <Crown size={12} /> Admin
                      </span>
                    ) : null}
                    {amAdmin && !isSelf ? (
                      <div className="member-actions">
                        {member.role !== 'admin' ? (
                          <button
                            type="button"
                            onClick={() => setConfirm({ type: 'promote', memberId: member.id, title: `Make ${member.displayName} an admin?`, description: 'Admins can rename the group, add or remove members, and delete any message.', confirmLabel: 'Make admin' })}
                            title="Make admin"
                          >
                            <Shield size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirm({ type: 'demote', memberId: member.id, title: `Remove admin from ${member.displayName}?`, description: 'They will remain a member with normal permissions.', confirmLabel: 'Remove admin' })}
                            title="Remove admin"
                          >
                            <ShieldCheck size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="is-danger"
                          onClick={() => setConfirm({ type: 'removeMember', memberId: member.id, title: `Remove ${member.displayName}?`, description: 'They will no longer see new messages in this group.', confirmLabel: 'Remove member' })}
                          title="Remove from group"
                        >
                          <UserMinus size={14} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {!isGroup && profile?.profile ? (
          <section className="details-section">
            <h4>About</h4>
            <p className="details-bio">{profile.profile.bio || 'No bio yet.'}</p>
            <dl className="details-facts">
              <div>
                <dt>Username</dt>
                <dd>@{profile.profile.username}</dd>
              </div>
              <div>
                <dt>Mutual friends</dt>
                <dd>{profile.profile.mutualFriends ?? 0}</dd>
              </div>
              <div>
                <dt>Joined</dt>
                <dd>{fullDate(profile.profile.createdAt)}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section className="details-section">
          <h4>Conversation</h4>
          <dl className="details-facts">
            <div>
              <dt>Type</dt>
              <dd>{isGroup ? 'Group chat' : 'Direct message'}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{fullDate(conversation.createdAt)}</dd>
            </div>
            <div>
              <dt>Notifications</dt>
              <dd>{muteValue(conversation) === 'off' ? 'On' : 'Muted'}</dd>
            </div>
          </dl>
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        loading={busy}
        title={confirm?.title}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel}
      />

      <Modal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename group"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={rename} loading={busy} disabled={!renameValue.trim()}>Save</Button>
          </>
        }
      >
        <Field label="Group name">
          <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={80} autoFocus />
        </Field>
      </Modal>

      <Modal
        open={addOpen}
        onClose={() => { setAddOpen(false); setSelected([]); }}
        title="Add members"
        description="Only your friends can be added to a group."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setAddOpen(false); setSelected([]); }} disabled={busy}>Cancel</Button>
            <Button onClick={addMembers} loading={busy} disabled={!selected.length}>Add {selected.length || ''}</Button>
          </>
        }
      >
        <div className="pick-list">
          {nonMembers.length === 0 ? (
            <p className="pick-empty">All your friends are already in this group.</p>
          ) : (
            nonMembers.map((friend) => {
              const checked = selected.includes(friend.id);
              return (
                <button
                  type="button"
                  key={friend.id}
                  className={`pick-row ${checked ? 'is-selected' : ''}`}
                  onClick={() =>
                    setSelected((prev) => (checked ? prev.filter((id) => id !== friend.id) : [...prev, friend.id]))
                  }
                >
                  <Avatar name={friend.displayName} src={friend.avatarUrl} size={38} online={friend.online} />
                  <span className="pick-copy">
                    <strong>{friend.displayName}</strong>
                    <span>@{friend.username}</span>
                  </span>
                  <span className={`pick-check ${checked ? 'is-on' : ''}`}>{checked ? <Check size={14} /> : null}</span>
                </button>
              );
            })
          )}
        </div>
      </Modal>

      <Modal
        open={muteOpen}
        onClose={() => setMuteOpen(false)}
        title="Mute notifications"
        description="Messages still arrive, but won't ping you."
        size="sm"
      >
        <div className="mute-options">
          {[
            ['off', 'Off — notify me normally'],
            ['1h', 'For 1 hour'],
            ['8h', 'For 8 hours'],
            ['1w', 'For 1 week'],
            ['forever', 'Until I turn it back on']
          ].map(([value, label]) => (
            <button type="button" key={value} className="mute-option" onClick={() => setMute(value)}>
              <BellOff size={16} /> {label}
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={`Report ${other?.displayName || 'user'}`}
        description="Reports are reviewed by administrators. False reports may be ignored."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReportOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={submitReport} loading={busy}>Submit report</Button>
          </>
        }
      >
        <form onSubmit={submitReport} className="stack">
          <Field label="Reason">
            <select value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
              {REPORT_REASONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Details" optional hint="Include anything that helps an administrator understand.">
            <textarea
              rows={4}
              maxLength={1000}
              value={reportDetails}
              onChange={(event) => setReportDetails(event.target.value)}
              placeholder="What happened?"
            />
          </Field>
        </form>
      </Modal>
    </aside>
  );
}
