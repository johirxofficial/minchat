import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { endpoints } from '../lib/api';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { useToast } from './ToastContext';

const CallContext = createContext(null);

const FALLBACK_ICE = [{ urls: ['stun:stun.l.google.com:19302'] }];

export function CallProvider({ children }) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const toast = useToast();

  const [call, setCallState] = useState(null);
  const [phase, setPhaseState] = useState('idle');
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [mediaError, setMediaError] = useState(null);

  const callRef = useRef(null);
  const phaseRef = useRef('idle');
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingCandidates = useRef([]);
  const iceServersRef = useRef(FALLBACK_ICE);
  const screenTrackRef = useRef(null);
  const ringtoneRef = useRef(null);
  const timerRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  const setCall = useCallback((value) => {
    callRef.current = value;
    setCallState(value);
  }, []);

  const setPhase = useCallback((value) => {
    phaseRef.current = value;
    setPhaseState(value);
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    endpoints
      .callConfig()
      .then((data) => {
        if (!cancelled && Array.isArray(data.iceServers) && data.iceServers.length) {
          iceServersRef.current = data.iceServers;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  const stopRingtone = useCallback(() => {
    const ring = ringtoneRef.current;
    if (!ring) return;
    clearInterval(ring.interval);
    try {
      ring.oscillator.stop();
      ring.context.close();
    } catch {
      // Audio context may already be closed.
    }
    ringtoneRef.current = null;
  }, []);

  const startRingtone = useCallback(() => {
    if (ringtoneRef.current) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const context = new Ctx();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 660;
      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      let high = false;
      const pulse = () => {
        high = !high;
        const now = context.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(high ? 0.05 : 0, now);
        gain.gain.linearRampToValueAtTime(high ? 0.12 : 0, now + 0.35);
      };
      pulse();
      const interval = setInterval(pulse, 1400);
      ringtoneRef.current = { context, oscillator, gain, interval };
    } catch {
      // Ringing sound is optional.
    }
  }, []);

  const stopLocalTracks = useCallback(() => {
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) track.stop();
      localStreamRef.current = null;
    }
    setLocalStream(null);
  }, []);

  const teardown = useCallback(
    ({ message = null, type = 'info' } = {}) => {
      stopRingtone();
      clearInterval(timerRef.current);
      timerRef.current = null;
      if (pcRef.current) {
        pcRef.current.onicecandidate = null;
        pcRef.current.ontrack = null;
        pcRef.current.onconnectionstatechange = null;
        try {
          pcRef.current.close();
        } catch {
          // Already closed.
        }
        pcRef.current = null;
      }
      if (screenTrackRef.current) {
        screenTrackRef.current.stop();
        screenTrackRef.current = null;
      }
      stopLocalTracks();
      setRemoteStream(null);
      pendingCandidates.current = [];
      setCall(null);
      setPhase('idle');
      setElapsed(0);
      setMicOn(true);
      setCamOn(true);
      setScreenSharing(false);
      setMediaError(null);
      if (message) toast[type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'](message);
    },
    [setCall, setPhase, stopLocalTracks, stopRingtone, toast]
  );

  const ensureMedia = useCallback(
    async (type) => {
      if (localStreamRef.current) return localStreamRef.current;
      if (!navigator.mediaDevices?.getUserMedia) {
        const err = new Error(
          'Calls need a secure connection (HTTPS) or localhost, and a browser with microphone support.'
        );
        setMediaError(err.message);
        throw err;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video:
          type === 'video'
            ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
            : false
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setMicOn(true);
      setCamOn(type === 'video');
      return stream;
    },
    []
  );

  const ensurePeer = useCallback(
    (callObj, stream) => {
      if (pcRef.current) return pcRef.current;
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      pcRef.current = pc;
      const local = stream || localStreamRef.current;
      if (local) {
        for (const track of local.getTracks()) pc.addTrack(track, local);
      }
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current?.emit('webrtc:ice', {
            callId: callObj.id,
            candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
          });
        }
      };
      pc.ontrack = (event) => {
        const [remote] = event.streams;
        if (remote) setRemoteStream(remote);
      };
      pc.onconnectionstatechange = () => {
        if (!pcRef.current) return;
        if (pc.state === 'connected') {
          stopRingtone();
          setPhase('active');
        } else if (pc.state === 'failed') {
          socketRef.current?.emit('call:end', { callId: callObj.id });
          teardown({ message: 'The call connection failed.', type: 'error' });
        }
      };
      return pc;
    },
    [setPhase, stopRingtone, teardown]
  );

  const flushCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;
    const queued = pendingCandidates.current;
    pendingCandidates.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // A stale candidate is not fatal.
      }
    }
  }, []);

  const emitWithAck = useCallback((event, payload, timeoutMs = 20000) => {
    return new Promise((resolve) => {
      const activeSocket = socketRef.current;
      if (!activeSocket) {
        resolve({ ok: false, error: { code: 'OFFLINE', message: 'You are offline.' } });
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: { code: 'TIMEOUT', message: 'The server did not respond.' } });
      }, timeoutMs);
      activeSocket.emit(event, payload, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response || { ok: false, error: { code: 'NO_RESPONSE', message: 'No response.' } });
      });
    });
  }, []);

  const startCall = useCallback(
    async (conversation, type) => {
      if (callRef.current) {
        toast.info('You are already on a call');
        return;
      }
      if (!conversation) return;
      const other =
        conversation.otherUser || conversation.members?.find((m) => m.id !== user?.id) || null;
      if (!other) {
        toast.error('Calls are only available in one-to-one chats');
        return;
      }
      setMediaError(null);
      try {
        await ensureMedia(type);
      } catch (err) {
        toast.error(err.message || 'Microphone or camera permission was denied.');
        teardown();
        return;
      }
      const provisional = {
        id: null,
        conversationId: conversation.id,
        type,
        status: 'ringing',
        caller: user,
        callee: other,
        startedAt: new Date().toISOString()
      };
      setCall(provisional);
      setPhase('outgoing');
      const response = await emitWithAck('call:start', { conversationId: conversation.id, type });
      if (!response.ok) {
        teardown();
        toast.error(response.error?.message || 'Unable to start the call');
        return;
      }
      setCall(response.call);
      setPhase('outgoing');
    },
    [emitWithAck, ensureMedia, setCall, setPhase, teardown, toast, user]
  );

  const acceptCall = useCallback(async () => {
    const active = callRef.current;
    if (!active) return;
    setMediaError(null);
    try {
      await ensureMedia(active.type);
    } catch (err) {
      toast.error(err.message || 'Microphone or camera permission was denied.');
      await emitWithAck('call:reject', { callId: active.id });
      teardown({ message: 'Call declined because no microphone was available.', type: 'error' });
      return;
    }
    stopRingtone();
    const response = await emitWithAck('call:accept', { callId: active.id });
    if (!response.ok) {
      teardown({ message: response.error?.message || 'This call is no longer available.', type: 'error' });
      return;
    }
    setCall(response.call);
    setPhase('connecting');
  }, [emitWithAck, ensureMedia, setCall, setPhase, stopRingtone, teardown, toast]);

  const rejectCall = useCallback(async () => {
    const active = callRef.current;
    if (!active) return;
    await emitWithAck('call:reject', { callId: active.id }, 8000);
    teardown({ message: 'Call declined' });
  }, [emitWithAck, teardown]);

  const endCall = useCallback(async () => {
    const active = callRef.current;
    if (!active) {
      teardown();
      return;
    }
    await emitWithAck('call:end', { callId: active.id }, 5000);
    teardown({ message: active.status === 'ringing' ? 'Call cancelled' : 'Call ended' });
  }, [emitWithAck, teardown]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !micOn;
    for (const track of stream.getAudioTracks()) track.enabled = next;
    setMicOn(next);
  }, [micOn]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !camOn;
    for (const track of stream.getVideoTracks()) track.enabled = next;
    setCamOn(next);
  }, [camOn]);

  const toggleScreenShare = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error('Screen sharing is not supported by this browser.');
      return;
    }
    if (screenSharing) {
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      setScreenSharing(false);
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
      if (cameraTrack && sender) await sender.replaceTrack(cameraTrack).catch(() => {});
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screen.getVideoTracks()[0];
      screenTrackRef.current = track;
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(track);
      setScreenSharing(true);
      track.onended = () => {
        setScreenSharing(false);
        screenTrackRef.current = null;
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
        const videoSender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
        if (cameraTrack && videoSender) videoSender.replaceTrack(cameraTrack).catch(() => {});
      };
    } catch {
      toast.error('Screen sharing was cancelled.');
    }
  }, [screenSharing, toast]);

  useEffect(() => {
    if (!socket) return undefined;

    const onIncoming = ({ call: incoming }) => {
      if (callRef.current) {
        socket.emit('call:reject', { callId: incoming.id });
        return;
      }
      setCall(incoming);
      setPhase('incoming');
      startRingtone();
    };

    const onRinging = ({ call: ringing }) => {
      if (callRef.current?.id && callRef.current.id !== ringing.id) return;
      setCall(ringing);
      setPhase('outgoing');
    };

    const onAccepted = async ({ call: accepted }) => {
      if (callRef.current?.id && callRef.current.id !== accepted.id) return;
      setCall(accepted);
      setPhase('connecting');
      stopRingtone();
      if (accepted.caller?.id !== user?.id) return;
      try {
        const pc = ensurePeer(accepted);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc:offer', { callId: accepted.id, sdp: pc.localDescription });
      } catch (err) {
        socket.emit('call:end', { callId: accepted.id });
        teardown({ message: 'Unable to establish the call.', type: 'error' });
      }
    };

    const onRejected = ({ call: rejected }) => {
      if (callRef.current?.id !== rejected.id) return;
      teardown({ message: 'Call declined' });
    };

    const onCancelled = ({ call: cancelled }) => {
      if (callRef.current?.id !== cancelled.id) return;
      const cameFrom = callRef.current?.callee?.displayName || 'Someone';
      teardown({ message: `Missed call from ${cameFrom}` });
    };

    const onEnded = ({ call: ended }) => {
      if (callRef.current?.id && callRef.current.id !== ended.id) return;
      teardown({ message: ended.status === 'missed' ? 'Missed call' : 'Call ended' });
    };

    const onOffer = async ({ callId, sdp }) => {
      const active = callRef.current;
      if (!active || active.id !== callId) return;
      const pc = ensurePeer(active);
      try {
        await pc.setRemoteDescription(sdp);
        await flushCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', { callId, sdp: pc.localDescription });
        setPhase('connecting');
      } catch {
        socket.emit('call:end', { callId });
        teardown({ message: 'Unable to establish the call.', type: 'error' });
      }
    };

    const onAnswer = async ({ callId, sdp }) => {
      const active = callRef.current;
      if (!active || active.id !== callId) return;
      const pc = pcRef.current;
      if (!pc || pc.signalingState !== 'have-local-offer') return;
      try {
        await pc.setRemoteDescription(sdp);
        await flushCandidates();
      } catch {
        // Late answers after teardown can be ignored.
      }
    };

    const onIce = async ({ callId, candidate }) => {
      const active = callRef.current;
      if (!active || active.id !== callId || !candidate) return;
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingCandidates.current.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // Non-fatal.
      }
    };

    const onDisconnect = () => {
      if (phaseRef.current !== 'idle' && phaseRef.current !== 'incoming') {
        teardown({ message: 'Call disconnected', type: 'error' });
      }
    };

    socket.on('call:incoming', onIncoming);
    socket.on('call:ringing', onRinging);
    socket.on('call:accepted', onAccepted);
    socket.on('call:rejected', onRejected);
    socket.on('call:cancelled', onCancelled);
    socket.on('call:ended', onEnded);
    socket.on('webrtc:offer', onOffer);
    socket.on('webrtc:answer', onAnswer);
    socket.on('webrtc:ice', onIce);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:ringing', onRinging);
      socket.off('call:accepted', onAccepted);
      socket.off('call:rejected', onRejected);
      socket.off('call:cancelled', onCancelled);
      socket.off('call:ended', onEnded);
      socket.off('webrtc:offer', onOffer);
      socket.off('webrtc:answer', onAnswer);
      socket.off('webrtc:ice', onIce);
      socket.off('disconnect', onDisconnect);
    };
  }, [
    socket,
    user,
    ensurePeer,
    flushCandidates,
    setCall,
    setPhase,
    startRingtone,
    stopRingtone,
    teardown
  ]);

  useEffect(() => {
    if (phase !== 'active' || !call?.answeredAt) {
      clearInterval(timerRef.current);
      return undefined;
    }
    const update = () => {
      const seconds = Math.max(0, Math.round((Date.now() - new Date(call.answeredAt).getTime()) / 1000));
      setElapsed(seconds);
    };
    update();
    timerRef.current = setInterval(update, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase, call?.answeredAt]);

  useEffect(() => {
    return () => {
      stopRingtone();
      clearInterval(timerRef.current);
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) track.stop();
      }
      if (pcRef.current) pcRef.current.close();
    };
  }, [stopRingtone]);

  const value = useMemo(
    () => ({
      call,
      phase,
      localStream,
      remoteStream,
      micOn,
      camOn,
      screenSharing,
      elapsed,
      mediaError,
      startCall,
      acceptCall,
      rejectCall,
      endCall,
      toggleMic,
      toggleCamera,
      toggleScreenShare
    }),
    [
      call,
      phase,
      localStream,
      remoteStream,
      micOn,
      camOn,
      screenSharing,
      elapsed,
      mediaError,
      startCall,
      acceptCall,
      rejectCall,
      endCall,
      toggleMic,
      toggleCamera,
      toggleScreenShare
    ]
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used inside CallProvider');
  return ctx;
}
