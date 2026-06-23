const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
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

// Rate limiter for auth endpoints — prevents brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { success: false, message: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for webhook — prevents flood attacks while allowing Meta retries
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  message: { success: false, message: "Too many webhook requests" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  swaggerOptions: { persistAuthorization: true },
}));

app.use("/api/auth", authLimiter, require("./modules/auth/auth.routes"));
app.use("/api/users", require("./modules/users/user.routes"));
app.use("/api/customers", require("./modules/customers/customer.routes"));
app.use("/api/conversations", require("./modules/conversations/conversation.routes"));
app.use("/api/messages", require("./modules/messages/message.routes"));
app.use("/api/media", require("./modules/media/media.routes"));
app.use("/api/webhooks", webhookLimiter, require("./modules/webhooks/webhook.routes"));
app.use("/api/audit", require("./modules/audit/audit.routes"));
app.use("/api/stats", require("./modules/stats/stats.routes"));
app.use("/api/templates", require("./modules/templates/template.routes"));
app.use("/api/campaigns", require("./modules/campaigns/campaign.routes"));

app.use(errorHandler);

module.exports = app;
