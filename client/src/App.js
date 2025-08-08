import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:5000'); // backend URL

function App() {
  const [partnerId, setPartnerId] = useState(null);
  const [initiator, setInitiator] = useState(false);
  const peerConnection = useRef(null);

  useEffect(() => {
    console.log("🚀 Connecting to backend...");

    peerConnection.current = new RTCPeerConnection();

    // Handle local ICE candidates
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate && partnerId) {
        socket.emit('ice-candidate', {
          candidate: event.candidate,
          partnerId
        });
      }
    };

    // Handle remote stream
    peerConnection.current.ontrack = (event) => {
      const remoteVideo = document.getElementById('remoteVideo');
      if (remoteVideo) remoteVideo.srcObject = event.streams[0];
    };

    // Ask for camera/mic
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        const localVideo = document.getElementById('localVideo');
        if (localVideo) localVideo.srcObject = stream;
        stream.getTracks().forEach(track =>
          peerConnection.current.addTrack(track, stream)
        );
      })
      .catch(console.error);

    // Join queue
    socket.emit('join');

    // Partner found
    socket.on('partner-found', async ({ partnerId, initiator }) => {
      console.log('🤝 Partner found:', partnerId, 'initiator:', initiator);
      setPartnerId(partnerId);
      setInitiator(initiator);

      if (initiator) {
        try {
          const offer = await peerConnection.current.createOffer();
          await peerConnection.current.setLocalDescription(offer);
          socket.emit('offer', { offer, partnerId });
        } catch (err) {
          console.error('Offer creation failed:', err);
        }
      }
    });

    // Got offer
    socket.on('offer', async ({ offer, partnerId }) => {
      try {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        socket.emit('answer', { answer, partnerId });
      } catch (err) {
        console.error('Answer creation failed:', err);
      }
    });

    // Got answer
    socket.on('answer', async ({ answer }) => {
      try {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (err) {
        console.error('Setting remote description from answer failed:', err);
      }
    });

    // Got ICE candidate
    socket.on('ice-candidate', async ({ candidate }) => {
      try {
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Adding ICE candidate failed:', err);
      }
    });

    // Partner disconnected
    socket.on('partner-disconnected', () => {
      console.log("💔 Partner disconnected");
      setPartnerId(null);
    });

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
