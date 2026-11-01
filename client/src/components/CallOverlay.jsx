import { useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  Phone,
  PhoneOff,
  Video,
  VideoOff
} from 'lucide-react';
import { Avatar, IconButton } from './ui';
import { useCall } from '../context/CallContext';
import { useAuth } from '../context/AuthContext';
import { clock } from '../lib/utils';

export default function CallOverlay() {
  const { phase, call, localStream, remoteStream, micOn, camOn, screenSharing, elapsed, mediaError, acceptCall, rejectCall, endCall, toggleMic, toggleCamera, toggleScreenShare } = useCall();
  const { user } = useAuth();
  const localRef = useRef(null);
  const remoteRef = useRef(null);

  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = localStream || null;
  }, [localStream, phase]);

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = remoteStream || null;
  }, [remoteStream, phase]);

  if (phase === 'idle' || !call) return null;

  const incoming = phase === 'incoming';
  const other = call.caller?.id === user?.id ? call.callee : call.caller;
  const video = call.type === 'video';
  const name = other?.displayName || other?.username || 'Unknown caller';
  const statusText = incoming
    ? `Incoming ${video ? 'video' : 'voice'} call`
    : phase === 'outgoing'
      ? 'Ringing…'
      : phase === 'connecting'
        ? 'Connecting…'
        : clock(elapsed);

  return (
    <div className={`call-overlay call-${phase} ${video ? 'call-video' : 'call-voice'}`} role="dialog" aria-modal="true" aria-label={`${video ? 'Video' : 'Voice'} call with ${name}`}>
      {video ? (
        <div className="call-stage">
          <video ref={remoteRef} autoPlay playsInline className="call-remote" />
          {!remoteStream || phase !== 'active' ? (
            <div className="call-waiting">
              <Avatar name={name} src={other?.avatarUrl} size={112} ring />
              <span className="call-pulse" />
            </div>
          ) : null}
          <div className="call-local-pip">
            <video ref={localRef} autoPlay playsInline muted className={camOn ? '' : 'is-hidden'} />
            {!camOn ? <span className="call-local-off">Camera off</span> : null}
          </div>
        </div>
      ) : (
        <div className="call-stage call-stage-voice">
          <video ref={remoteRef} autoPlay playsInline className="call-audio-only" />
          <div className="call-waiting">
            <Avatar name={name} src={other?.avatarUrl} size={132} ring />
            {phase === 'outgoing' || phase === 'connecting' || incoming ? <span className="call-pulse" /> : null}
            {phase === 'active' ? <span className="call-live-dot" /> : null}
          </div>
        </div>
      )}

      <div className="call-topbar">
        <span className="call-tag">{video ? 'Video call' : 'Voice call'}</span>
      </div>

      <div className="call-info">
        <h2>{name}</h2>
        <p className={phase === 'active' ? 'is-live' : ''}>{statusText}</p>
        {!window.isSecureContext ? (
          <p className="call-warning">Calls need HTTPS in this browser. Open MinChat over the secure listener.</p>
        ) : null}
        {mediaError ? <p className="call-warning">{mediaError}</p> : null}
      </div>

      <div className="call-controls">
        {incoming ? (
          <>
            <button type="button" className="call-btn call-btn-accept" onClick={acceptCall}>
              <span className="call-btn-icon">
                <Phone size={22} />
              </span>
              <span>Accept</span>
            </button>
            <button type="button" className="call-btn call-btn-reject" onClick={rejectCall}>
              <span className="call-btn-icon">
                <PhoneOff size={22} />
              </span>
              <span>Decline</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`call-btn call-btn-round ${micOn ? '' : 'is-off'}`}
              onClick={toggleMic}
              aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
              title={micOn ? 'Mute' : 'Unmute'}
            >
              <span className="call-btn-icon">{micOn ? <Mic size={20} /> : <MicOff size={20} />}</span>
            </button>
            {video ? (
              <button
                type="button"
                className={`call-btn call-btn-round ${camOn ? '' : 'is-off'}`}
                onClick={toggleCamera}
                aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
                title={camOn ? 'Camera off' : 'Camera on'}
              >
                <span className="call-btn-icon">{camOn ? <Video size={20} /> : <VideoOff size={20} />}</span>
              </button>
            ) : null}
            {video && phase === 'active' ? (
              <button
                type="button"
                className={`call-btn call-btn-round ${screenSharing ? 'is-on' : ''}`}
                onClick={toggleScreenShare}
                aria-label={screenSharing ? 'Stop sharing screen' : 'Share screen'}
                title={screenSharing ? 'Stop sharing' : 'Share screen'}
              >
                <span className="call-btn-icon">
                  {screenSharing ? <MonitorOff size={20} /> : <MonitorUp size={20} />}
                </span>
              </button>
            ) : null}
            <button
              type="button"
              className="call-btn call-btn-round call-btn-end"
              onClick={endCall}
              aria-label="End call"
              title="End call"
            >
              <span className="call-btn-icon">
                <PhoneOff size={20} />
              </span>
            </button>
          </>
        )}
      </div>

      <div className="call-runner">
        <IconButton label="Mute" icon={Mic} className="sr-only-control" style={{ display: 'none' }} />
      </div>
    </div>
  );
}
