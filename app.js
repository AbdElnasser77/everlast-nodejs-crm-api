const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./config/swagger");
const errorHandler = require("./middleware/errorHandler");

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  swaggerOptions: { persistAuthorization: true },
}));

app.use("/api/auth", require("./modules/auth/auth.routes"));
app.use("/api/users", require("./modules/users/user.routes"));
app.use("/api/customers", require("./modules/customers/customer.routes"));
app.use("/api/conversations", require("./modules/conversations/conversation.routes"));
app.use("/api/messages", require("./modules/messages/message.routes"));
app.use("/api/media", require("./modules/media/media.routes"));
app.use("/api/webhooks", require("./modules/webhooks/webhook.routes"));
app.use("/api/audit", require("./modules/audit/audit.routes"));
app.use("/api/stats", require("./modules/stats/stats.routes"));

app.use(errorHandler);

module.exports = app;
