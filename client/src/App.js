import React, { useRef, useEffect, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";

const socket = io("http://localhost:5000"); // we’ll change this later for deployment

function App() {
  const myVideo = useRef();
  const userVideo = useRef();
  const [stream, setStream] = useState(null);
  const [peer, setPeer] = useState(null);

  useEffect(() => {
    // Get webcam + mic
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(currentStream => {
      setStream(currentStream);
      if (myVideo.current) {
        myVideo.current.srcObject = currentStream;
      }

      // Handle partner connection from server
      socket.on("partner", (partnerId) => {
        const newPeer = new Peer({
          initiator: true,
          trickle: false,
          stream: currentStream,
        });

        newPeer.on("signal", data => {
          socket.emit("signal", { to: partnerId, data });
        });

        newPeer.on("stream", partnerStream => {
          if (userVideo.current) {
            userVideo.current.srcObject = partnerStream;
          }
        });

        socket.on("signal", ({ data }) => {
          newPeer.signal(data);
        });

        setPeer(newPeer);
      });

      // If someone else initiates the call
      socket.on("signal", ({ from, data }) => {
        const newPeer = new Peer({
          initiator: false,
          trickle: false,
          stream: currentStream,
        });

        newPeer.on("signal", signalData => {
          socket.emit("signal", { to: from, data: signalData });
        });

        newPeer.on("stream", partnerStream => {
          if (userVideo.current) {
            userVideo.current.srcObject = partnerStream;
          }
        });

        newPeer.signal(data);
        setPeer(newPeer);
      });
    });
  }, []);

  return (
    <div style={{ textAlign: "center" }}>
      <h1>Omegle Clone 🚀</h1>
      <div style={{ display: "flex", justifyContent: "center", gap: "20px" }}>
        <div>
          <h3>You</h3>
          <video ref={myVideo} autoPlay playsInline muted style={{ width: "300px", border: "1px solid black" }} />
        </div>
        <div>
          <h3>Stranger</h3>
          <video ref={userVideo} autoPlay playsInline style={{ width: "300px", border: "1px solid black" }} />
        </div>
      </div>
    </div>
  );
}

export default App;
