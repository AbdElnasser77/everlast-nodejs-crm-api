let io;

const initSocket = (httpServer) => {
  io = require("socket.io")(httpServer, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log("Socket client connected:", socket.id);

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
