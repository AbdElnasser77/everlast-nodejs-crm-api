const prisma = require("../config/prisma");

const logAudit = ({ action, actor, targetType, targetId, details }) => {
  prisma.auditLog.create({
    data: {
      action,
      actorId: actor?.id || null,
      actorUsername: actor?.username || null,
      targetType,
      targetId,
      details: details || null,
    },
  }).catch((err) => console.error("Audit log failed:", err.message));
};

module.exports = logAudit;
