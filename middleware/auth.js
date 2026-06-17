const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");
const AppError = require("../utils/AppError");

const protect = (req, res, next) => {
  // read from cookie first, fall back to Authorization header (for Swagger/API clients)
  const token =
    req.cookies?.token ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.split(" ")[1]
      : null);

  if (!token) return next(new AppError("No token provided", 401));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.id, username: decoded.username, role: decoded.role };

    prisma.user.update({
      where: { id: decoded.id },
      data: { lastActiveAt: new Date() },
    }).catch(() => {});

    next();
  } catch {
    next(new AppError("Invalid or expired token", 401));
  }
};

module.exports = protect;
