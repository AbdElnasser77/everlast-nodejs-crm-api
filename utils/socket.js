const cookie = require("cookie");
const jwt = require("jsonwebtoken");

let io;

const initSocket = (httpServer) => {
  io = require("socket.io")(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      credentials: true,
    },
  });

  // Authenticate every socket connection. The browser sends the httpOnly JWT
  // cookie on the handshake (client must use withCredentials); non-browser
  // clients may pass the token via handshake auth instead. Reject anything
  // without a valid token so message events are never broadcast to strangers.
  io.use((socket, next) => {
    try {
      const cookies = cookie.parse(socket.handshake.headers.cookie || "");
      const token = cookies.token || socket.handshake.auth?.token;
      if (!token) return next(new Error("Unauthorized"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = { id: decoded.id, username: decoded.username, role: decoded.role };
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    console.log("Socket client connected:", socket.id, "user:", socket.user?.username);

    socket.on("typing.start", ({ conversationId, username }) => {
      socket.broadcast.emit("typing.start", { conversationId, username });
    });

    socket.on("typing.stop", ({ conversationId, username }) => {
      socket.broadcast.emit("typing.stop", { conversationId, username });
    });

    socket.on("disconnect", () => {
      console.log("Socket client disconnected:", socket.id);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
};

module.exports = { initSocket, getIO };
