require("./config/env");
const http = require("http");
const app = require("./app");
const connectDB = require("./config/database");
const { initSocket } = require("./utils/socket");

const server = http.createServer(app);
initSocket(server);

connectDB().then(() => {
  server.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
  });
});
