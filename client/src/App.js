// src/App.js
import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';

const BACKEND = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5001';
const socket = io(BACKEND, { autoConnect: true });

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' } // OK without ?transport=udp
];

function App() {
  const [partnerId, setPartnerId] = useState(null);
  const [role, setRole] = useState('none'); // 'initiator' | 'waiter' | 'none'

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);

  const partnerIdRef = useRef(null);
  const isInitiatorRef = useRef(false);

  // helper to create a fresh PeerConnection with handlers
  function createPeerConnection() {
    console.log('[pc] createPeerConnection()');
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate && partnerIdRef.current) {
        console.log('[pc] sending ICE candidate to', partnerIdRef.current);
        socket.emit('ice-candidate', { candidate: event.candidate, partnerId: partnerIdRef.current });
      }
    };

    pc.ontrack = (event) => {
      console.log('[pc] ontrack: got streams:', event.streams.map(s => s.id));
      // Use a dedicated MediaStream for remoteVideo to avoid mixing local/remote
      // If remoteVideoRef already has srcObject and it's the same stream, do nothing
      const remoteEl = remoteVideoRef.current;
      if (!remoteEl) return;
      const incomingStream = event.streams && event.streams[0];
      if (!incomingStream) return;

      // Avoid replacing if already same stream id
      const current = remoteEl.srcObject;
      if (current && current.id === incomingStream.id) {
        console.log('[pc] remote stream same as current — ignoring');
        return;
      }
      console.log('[pc] setting remote video srcObject to stream id', incomingStream.id);
      remoteEl.srcObject = incomingStream;
    };

    pc.onconnectionstatechange = () => {
      console.log('[pc] connectionState:', pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[pc] iceConnectionState:', pc.iceConnectionState);
    };

    return pc;
  }

  // attach local tracks (call after localStreamRef is populated and after pc created)
  function attachLocalTracksToPc(pc) {
    if (!pc || !localStreamRef.current) return;
    try {
      for (const track of localStreamRef.current.getTracks()) {
        pc.addTrack(track, localStreamRef.current);
      }
      console.log('[pc] attached local tracks to pc');
    } catch (e) {
      console.warn('[pc] attachLocalTracks error', e);
    }
  }

  useEffect(() => {
    // socket debug
    socket.on('connect', () => {
      console.log('[socket] connected, id=', socket.id);
    });
    socket.on('connect_error', (err) => {
      console.error('[socket] connect_error', err);
    });

    // get local media immediately once on mount
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        console.log('[media] got local stream id=', stream.id);
      } catch (err) {
        console.error('[media] getUserMedia failed', err);
      }

      // Now ask server to join
      console.log('[app] emitting join');
      socket.emit('join');
    })();

    // ----- SIGNALING HANDLERS -----
    socket.on('partner-found', async ({ partnerId: pid, initiator }) => {
      console.log('[signal] partner-found', pid, 'initiator=', initiator);
      partnerIdRef.current = pid;
      setPartnerId(pid);
      isInitiatorRef.current = !!initiator;
      setRole(initiator ? 'initiator' : 'waiter');

      // reset remote video
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

      // create a fresh pc
      pcRef.current = createPeerConnection();
      attachLocalTracksToPc(pcRef.current);

      // If initiator -> create offer and send
      if (initiator) {
        try {
          console.log('[signal] initiator creating offer');
          const offer = await pcRef.current.createOffer();
          await pcRef.current.setLocalDescription(offer);
          socket.emit('offer', { offer, partnerId: pid });
          console.log('[signal] offer sent to', pid);
        } catch (err) {
          console.error('[signal] failed to create/send offer', err);
        }
      }
    });

    socket.on('offer', async ({ offer, partnerId: fromId }) => {
      console.log('[signal] received offer from', fromId);
      partnerIdRef.current = fromId;
      setPartnerId(fromId);
      isInitiatorRef.current = false;
      setRole('waiter');

      // ensure pc exists and local tracks attached
      if (!pcRef.current) {
        pcRef.current = createPeerConnection();
      }
      attachLocalTracksToPc(pcRef.current);

      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        socket.emit('answer', { answer, partnerId: fromId });
        console.log('[signal] answer sent to', fromId);
      } catch (err) {
        console.error('[signal] error handling offer', err);
      }
    });

    socket.on('answer', async ({ answer }) => {
      console.log('[signal] received answer');
      try {
        if (pcRef.current) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        }
      } catch (err) {
        console.error('[signal] error applying answer', err);
      }
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      // candidate may be null sometimes
      if (!candidate) return;
      try {
        if (pcRef.current) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          console.log('[signal] added remote ICE candidate');
        }
      } catch (err) {
        console.error('[signal] failed to add ICE candidate', err);
      }
    });

    socket.on('partner-disconnected', ({ partnerId: pid }) => {
      console.log('[signal] partner-disconnected', pid);
      // cleanup
      setPartnerId(null);
      partnerIdRef.current = null;
      isInitiatorRef.current = false;
      setRole('none');

      if (pcRef.current) {
        try { pcRef.current.close(); } catch (e) {}
        pcRef.current = null;
      }
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

      // auto rejoin
      console.log('[signal] rejoining queue');
      socket.emit('join');
    });

    // cleanup on unmount
    return () => {
      try { socket.off('partner-found'); } catch {}
      try { socket.off('offer'); } catch {}
      try { socket.off('answer'); } catch {}
      try { socket.off('ice-candidate'); } catch {}
      try { socket.off('partner-disconnected'); } catch {}
      if (pcRef.current) {
        try { pcRef.current.close(); } catch {}
        pcRef.current = null;
      }
      if (localStreamRef.current) {
        try { localStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
        localStreamRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{ padding: 12 }}>
      <h2>Omegle Clone (debug)</h2>
      <div style={{ display: 'flex', gap: 12 }}>
        <div>
          <h4>You</h4>
          <video ref={localVideoRef} autoPlay playsInline muted style={{ width: 320, height: 240, background: '#000' }} />
        </div>
        <div>
          <h4>Partner</h4>
          <video ref={remoteVideoRef} autoPlay playsInline style={{ width: 320, height: 240, background: '#000' }} />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div><strong>Socket ID:</strong> {socket.id}</div>
        <div><strong>Partner ID:</strong> {partnerId || 'none'}</div>
        <div><strong>Role:</strong> {role}</div>
      </div>

      <div style={{ marginTop: 8 }}>
        <small>Open two separate browsers (or one regular + one incognito) and allow camera/mic.</small>
      </div>
    </div>
  );
}

export default App;
