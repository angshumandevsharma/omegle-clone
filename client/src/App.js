import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:5000'); // backend URL

function App() {
  const [partnerId, setPartnerId] = useState(null);
  const [initiator, setInitiator] = useState(false);
  const peerConnection = useRef(null);
  const partnerIdRef = useRef(null);
  const localStreamRef = useRef(null);
  const localMediaReadyResolver = useRef(null);
  const localMediaReadyPromise = useRef(new Promise((resolve) => { localMediaReadyResolver.current = resolve; }));
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (hasInitializedRef.current) return; // guard against StrictMode double-invoke
    hasInitializedRef.current = true;

    console.log("🚀 Connecting to backend...");

    peerConnection.current = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }
      ]
    });

    peerConnection.current.onconnectionstatechange = () => {
      console.log('PC connection state:', peerConnection.current.connectionState);
    };

    // Handle local ICE candidates (use ref to avoid stale state)
    peerConnection.current.onicecandidate = (event) => {
      const currentPartnerId = partnerIdRef.current;
      if (event.candidate && currentPartnerId) {
        socket.emit('ice-candidate', {
          candidate: event.candidate,
          partnerId: currentPartnerId
        });
      }
    };

    // Handle remote stream
    peerConnection.current.ontrack = (event) => {
      const remoteVideo = document.getElementById('remoteVideo');
      if (remoteVideo && (!remoteVideo.srcObject || remoteVideo.srcObject.id !== event.streams[0].id)) {
        remoteVideo.srcObject = event.streams[0];
      }
    };

    // Some browsers require explicit negotiation when needed
    peerConnection.current.onnegotiationneeded = async () => {
      try {
        if (initiator && partnerIdRef.current) {
          await localMediaReadyPromise.current;
          const offer = await peerConnection.current.createOffer();
          await peerConnection.current.setLocalDescription(offer);
          socket.emit('offer', { offer, partnerId: partnerIdRef.current });
        }
      } catch (err) {
        console.error('Negotiationneeded offer failed:', err);
      }
    };

    // Ask for camera/mic
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        localStreamRef.current = stream;
        const localVideo = document.getElementById('localVideo');
        if (localVideo) localVideo.srcObject = stream;
        stream.getTracks().forEach(track =>
          peerConnection.current.addTrack(track, stream)
        );
        // Mark local media ready
        if (localMediaReadyResolver.current) {
          localMediaReadyResolver.current();
        }
      })
      .catch((err) => {
        console.error('getUserMedia failed:', err);
        if (localMediaReadyResolver.current) {
          localMediaReadyResolver.current();
        }
      });

    // Join queue
    socket.emit('join');

    const onPartnerFound = async ({ partnerId, initiator }) => {
      console.log('🤝 Partner found:', partnerId, 'initiator:', initiator);
      setPartnerId(partnerId);
      partnerIdRef.current = partnerId;
      setInitiator(initiator);

      if (initiator) {
        try {
          await localMediaReadyPromise.current;
          const offer = await peerConnection.current.createOffer();
          await peerConnection.current.setLocalDescription(offer);
          socket.emit('offer', { offer, partnerId });
        } catch (err) {
          console.error('Offer creation failed:', err);
        }
      }
    };

    const onOffer = async ({ offer, partnerId }) => {
      try {
        await localMediaReadyPromise.current; // ensure our tracks are present
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        socket.emit('answer', { answer, partnerId });
      } catch (err) {
        console.error('Answer creation failed:', err);
      }
    };

    const onAnswer = async ({ answer }) => {
      try {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (err) {
        console.error('Setting remote description from answer failed:', err);
      }
    };

    const onIceCandidate = async ({ candidate }) => {
      try {
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Adding ICE candidate failed:', err);
      }
    };

    const onPartnerDisconnected = () => {
      console.log("💔 Partner disconnected");
      setPartnerId(null);
      partnerIdRef.current = null;
      if (peerConnection.current) {
        try { peerConnection.current.close(); } catch {}
      }
      if (localStreamRef.current) {
        try { localStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
      }
    };

    // Wire up socket handlers
    socket.on('partner-found', onPartnerFound);
    socket.on('offer', onOffer);
    socket.on('answer', onAnswer);
    socket.on('ice-candidate', onIceCandidate);
    socket.on('partner-disconnected', onPartnerDisconnected);

    return () => {
      // Cleanup
      socket.off('partner-found', onPartnerFound);
      socket.off('offer', onOffer);
      socket.off('answer', onAnswer);
      socket.off('ice-candidate', onIceCandidate);
      socket.off('partner-disconnected', onPartnerDisconnected);
      if (peerConnection.current) {
        try { peerConnection.current.close(); } catch {}
      }
      if (localStreamRef.current) {
        try { localStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
      }
    };

  }, []);

  return (
    <div>
      <h1>Omegle Clone</h1>
      <video id="localVideo" autoPlay playsInline muted></video>
      <video id="remoteVideo" autoPlay playsInline></video>
    </div>
  );
}

export default App;
