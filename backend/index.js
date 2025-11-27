import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import axios from "axios";

const app = express();
const server = http.createServer(app);

const url = `https://wecode-realtimecodeeditor-1.onrender.com/`;
const interval = 30000;

function reloadWebsite() {
  axios
    .get(url)
    .then((response) => {
      console.log("website reloded");
    })
    .catch((error) => {
      // console.error(`Error : ${error.message}`);
    });
}

setInterval(reloadWebsite, interval);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const rooms = new Map();

const RUNTIME_VERSIONS = {
  javascript: "18.15.0",
  python: "3.10.0",
  java: "15.0.2",
  cpp: "10.2.0"
};

io.on("connection", (socket) => {
  console.log("User Connected", socket.id);

  let currentRoom = null;
  let currentUser = null;

  socket.on("join", ({ roomId, userName }) => {
    if (currentRoom) {
      leaveRoom(socket, currentRoom, currentUser);
    }

    currentRoom = roomId;
    currentUser = userName;

    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Set(),
        currentCode: "// start code here",
        currentLanguage: "javascript",
        currentOutput: "",
        messages: [] 
      });
    }

    const room = rooms.get(roomId);

    // --- NEW: System Message for JOIN ---
    const joinMsg = {
        sender: "System",
        text: `${userName} joined the room`,
        time: new Date().toLocaleTimeString()
    };
    room.messages.push(joinMsg); // Save to history
    socket.to(roomId).emit("receiveMessage", joinMsg); // Broadcast to others
    // ------------------------------------

    room.users.add(userName);

    socket.emit("initialState", {
      code: room.currentCode,
      language: room.currentLanguage,
      output: room.currentOutput,
      messages: room.messages,
      users: Array.from(room.users)
    });

    socket.to(roomId).emit("userJoined", { 
       user: userName, 
       users: Array.from(room.users) 
    });
  });

  socket.on("codeChange", ({ roomId, code }) => {
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.currentCode = code;
      socket.to(roomId).emit("codeUpdate", code);
    }
  });

  socket.on("languageChange", ({ roomId, language }) => {
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.currentLanguage = language;
      io.to(roomId).emit("languageUpdate", language);
    }
  });

  socket.on("compileCode", async ({ code, roomId, language, version }) => {
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      const pistonVersion = RUNTIME_VERSIONS[language] || "*";

      try {
        const response = await axios.post(
          "https://emkc.org/api/v2/piston/execute",
          {
            language,
            version: pistonVersion,
            files: [{ content: code }],
          }
        );

        room.currentOutput = response.data.run.output; 
        io.to(roomId).emit("codeResponse", response.data);
      } catch (error) {
        console.error("Compile error:", error);
        io.to(roomId).emit("codeResponse", {
            run: {
                output: "Failed to execute code.\n" + (error.response?.data?.message || error.message)
            }
        });
      }
    }
  });

  socket.on("sendMessage", ({ roomId, message, userName }) => {
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      constZF = { sender: userName, text: message, time: new Date().toLocaleTimeString() };
      room.messages.push(constZF);
      io.to(roomId).emit("receiveMessage", constZF);
    }
  });

  socket.on("typing", ({ roomId, userName }) => {
    socket.to(roomId).emit("userTyping", userName);
  });

  socket.on("leaveRoom", () => {
    leaveRoom(socket, currentRoom, currentUser);
    currentRoom = null;
    currentUser = null;
  });

  socket.on("disconnect", () => {
    leaveRoom(socket, currentRoom, currentUser);
  });
});

function leaveRoom(socket, roomId, userName) {
  if (roomId && rooms.has(roomId)) {
    const room = rooms.get(roomId);

    // --- NEW: System Message for LEAVE ---
    const leaveMsg = {
        sender: "System",
        text: `${userName} left the room`,
        time: new Date().toLocaleTimeString()
    };
    room.messages.push(leaveMsg);
    io.to(roomId).emit("receiveMessage", leaveMsg);
    // -------------------------------------

    room.users.delete(userName);
    socket.leave(roomId);
    
    io.to(roomId).emit("userJoined", { 
        user: null, 
        users: Array.from(room.users) 
    });

    if (room.users.size === 0) {
      rooms.delete(roomId);
    }
  }
}

const port = process.env.PORT || 5000;
const __dirname = path.resolve();

app.use(express.static(path.join(__dirname, "/frontend/dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
});

server.listen(port, () => {
  console.log(`Server is working on port ${port}`);
});