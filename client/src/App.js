import React, { useRef, useState } from "react";

// Removed eager imports of socket.io-client and simple-peer to enable code-splitting

function App() {
  const myVideo = useRef();
  const userVideo = useRef();
  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const [isStarted, setIsStarted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleStart = async () => {
    try {
      // Request media only on user interaction to avoid blocking initial load
      const currentStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (myVideo.current) {
        myVideo.current.srcObject = currentStream;
      }

      // Lazy-load socket.io-client
      const { default: io } = await import(/* webpackChunkName: "socket-io-client" */ "socket.io-client");
      const serverUrl = process.env.REACT_APP_SERVER_URL || "http://localhost:5000"; // configurable for deployment
      const socket = io(serverUrl, {
        transports: ["websocket"], // prefer websocket to reduce handshake overhead
      });
      socketRef.current = socket;

      socket.on("partner", async (partnerId) => {
        const { default: Peer } = await import(/* webpackChunkName: "simple-peer" */ "simple-peer");
        const newPeer = new Peer({
          initiator: true,
          trickle: false,
          stream: currentStream,
        });

        newPeer.on("signal", (data) => {
          socket.emit("signal", { to: partnerId, data });
        });

        newPeer.on("stream", (partnerStream) => {
          if (userVideo.current) {
            userVideo.current.srcObject = partnerStream;
          }
        });

        socket.on("signal", ({ data }) => {
          newPeer.signal(data);
        });

        peerRef.current = newPeer;
      });

      socket.on("signal", async ({ from, data }) => {
        const { default: Peer } = await import(/* webpackChunkName: "simple-peer" */ "simple-peer");
        const newPeer = new Peer({
          initiator: false,
          trickle: false,
          stream: currentStream,
        });

        newPeer.on("signal", (signalData) => {
          socket.emit("signal", { to: from, data: signalData });
        });

        newPeer.on("stream", (partnerStream) => {
          if (userVideo.current) {
            userVideo.current.srcObject = partnerStream;
          }
        });

        newPeer.signal(data);
        peerRef.current = newPeer;
      });

      setIsStarted(true);
    } catch (err) {
      setErrorMessage(err?.message || "Failed to start media or connection");
    }
  };

  return (
    <div style={{ textAlign: "center" }}>
      <h1>Omegle Clone 🚀</h1>

      {!isStarted && (
        <div style={{ margin: "20px 0" }}>
          <button onClick={handleStart} style={{ padding: "10px 16px", fontSize: "16px" }}>
            Start
          </button>
          {errorMessage && (
            <div style={{ color: "red", marginTop: "10px" }}>{errorMessage}</div>
          )}
        </div>
      )}

      {isStarted && (
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
      )}
    </div>
  );
}

export default App;
