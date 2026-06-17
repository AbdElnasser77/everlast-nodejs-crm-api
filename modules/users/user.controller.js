const bcryptjs = require("bcryptjs");
const prisma = require("../../config/prisma");
const AppError = require("../../utils/AppError");
const logAudit = require("../../utils/audit");

const SAFE_SELECT = {
  id: true,
  name: true,
  username: true,
  role: true,
  status: true,
  lastActiveAt: true,
  createdAt: true,
  updatedAt: true,
};

// ── Admin: list all users ─────────────────────────────────────────────────────
const getAllUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const where = {};
    if (req.query.role) where.role = req.query.role;
    if (req.query.status) where.status = req.query.status;
    if (req.query.search) {
      where.OR = [
        { name: { contains: req.query.search, mode: "insensitive" } },
        { username: { contains: req.query.search, mode: "insensitive" } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, select: SAFE_SELECT, orderBy: { createdAt: "desc" }, skip, take: limit }),
      prisma.user.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: users,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

// ── Admin: get single user ────────────────────────────────────────────────────
const getUserById = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(req.params.id) },
      select: {
        ...SAFE_SELECT,
        _count: { select: { messages: true, assignedConversations: true } },
      },
    });
    if (!user) return next(new AppError("User not found", 404));
    res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

// ── Admin: create agent ───────────────────────────────────────────────────────
const createUser = async (req, res, next) => {
  try {
    const { name, username, password, role = "AGENT" } = req.body;
    if (!username || !password) return next(new AppError("Username and password are required", 400));
    if (password.length < 8) return next(new AppError("Password must be at least 8 characters", 400));
    if (!["ADMIN", "AGENT"].includes(role)) return next(new AppError("Role must be ADMIN or AGENT", 400));

    const passwordHash = await bcryptjs.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, username, passwordHash, role },
      select: SAFE_SELECT,
    });

    logAudit({
      action: "user.created",
      actor: req.user,
      targetType: "user",
      targetId: user.id,
      details: { username: user.username, role: user.role },
    });

    res.status(201).json({ success: true, data: user });
  } catch (err) {
    if (err.code === "P2002") return next(new AppError("Username already taken", 409));
    next(err);
  }
};

// ── Admin: update user ────────────────────────────────────────────────────────
const updateUser = async (req, res, next) => {
  try {
    const { name, username, role, status } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (username !== undefined) data.username = username;
    if (role !== undefined) {
      if (!["ADMIN", "AGENT"].includes(role)) return next(new AppError("Role must be ADMIN or AGENT", 400));
      data.role = role;
    }
    if (status !== undefined) {
      if (!["ONLINE", "OFFLINE", "ON_BREAK"].includes(status)) {
        return next(new AppError("Status must be ONLINE, OFFLINE, or ON_BREAK", 400));
      }
      data.status = status;
    }

    const user = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data,
      select: SAFE_SELECT,
    });

    logAudit({
      action: "user.updated",
      actor: req.user,
      targetType: "user",
      targetId: user.id,
      details: data,
    });

    res.status(200).json({ success: true, data: user });
  } catch (err) {
    if (err.code === "P2025") return next(new AppError("User not found", 404));
    if (err.code === "P2002") return next(new AppError("Username already taken", 409));
    next(err);
  }
};

// ── Admin: reset any user's password ─────────────────────────────────────────
const resetPassword = async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) return next(new AppError("Password must be at least 8 characters", 400));

    const passwordHash = await bcryptjs.hash(password, 12);
    const user = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: { passwordHash },
      select: SAFE_SELECT,
    });

    logAudit({
      action: "user.password_reset",
      actor: req.user,
      targetType: "user",
      targetId: user.id,
      details: { resetBy: req.user.username },
    });

    res.status(200).json({ success: true, message: "Password reset successfully" });
  } catch (err) {
    if (err.code === "P2025") return next(new AppError("User not found", 404));
    next(err);
  }
};

// ── Admin: delete user ────────────────────────────────────────────────────────
const deleteUser = async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id);

    if (targetId === req.user.id) {
      return next(new AppError("You cannot delete your own account", 400));
    }

    await prisma.user.delete({ where: { id: targetId } });

    logAudit({
      action: "user.deleted",
      actor: req.user,
      targetType: "user",
      targetId,
      details: null,
    });

    res.status(200).json({ success: true, message: "User deleted" });
  } catch (err) {
    if (err.code === "P2025") return next(new AppError("User not found", 404));
    next(err);
  }
};

// ── Self: get own profile ─────────────────────────────────────────────────────
const getMe = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        ...SAFE_SELECT,
        _count: { select: { messages: true, assignedConversations: true } },
      },
    });
    res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

// ── Self: update own status ───────────────────────────────────────────────────
const updateMyStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!["ONLINE", "OFFLINE", "ON_BREAK"].includes(status)) {
      return next(new AppError("Status must be ONLINE, OFFLINE, or ON_BREAK", 400));
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { status },
      select: SAFE_SELECT,
    });

    res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

// ── Self: change own password ─────────────────────────────────────────────────
const changeMyPassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return next(new AppError("currentPassword and newPassword are required", 400));
    }
    if (newPassword.length < 8) return next(new AppError("New password must be at least 8 characters", 400));

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const isMatch = await bcryptjs.compare(currentPassword, user.passwordHash);
    if (!isMatch) return next(new AppError("Current password is incorrect", 401));

    const passwordHash = await bcryptjs.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });

    res.status(200).json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  resetPassword,
  deleteUser,
  getMe,
  updateMyStatus,
  changeMyPassword,
};
