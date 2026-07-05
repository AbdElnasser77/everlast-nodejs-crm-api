const { parse } = require("csv-parse/sync");
const prisma = require("../../config/prisma");
const AppError = require("../../utils/AppError");

const getAllCustomers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const where = {};
    if (req.query.search) {
      where.OR = [
        { name: { contains: req.query.search, mode: "insensitive" } },
        { phone: { contains: req.query.search, mode: "insensitive" } },
        { email: { contains: req.query.search, mode: "insensitive" } },
      ];
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      prisma.customer.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: customers,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

const getCustomerById = async (req, res, next) => {
  try {
    const customer = await prisma.customer.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!customer) return next(new AppError("Customer not found", 404));
    res.status(200).json({ success: true, data: customer });
  } catch (err) {
    next(err);
  }
};

const createCustomer = async (req, res, next) => {
  try {
    const { name, phone, email, tags, notes } = req.body;
    if (!phone) return next(new AppError("Phone number is required", 400));

    const existing = await prisma.customer.findUnique({ where: { phone } });
    if (existing) return next(new AppError("Customer with this phone already exists", 409));

    const customer = await prisma.customer.create({
      data: {
        name,
        phone,
        email: email || null,
        tags: Array.isArray(tags) ? tags : [],
        notes: notes || null,
      },
    });
    res.status(201).json({ success: true, data: customer });
  } catch (err) {
    if (err.code === "P2002") return next(new AppError("Email already in use", 409));
    next(err);
  }
};

const updateCustomer = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { name, phone, email, tags, notes, optedOut } = req.body;

    // Validate phone uniqueness before updating
    if (phone !== undefined) {
      const conflict = await prisma.customer.findFirst({
        where: { phone, id: { not: id } },
      });
      if (conflict) return next(new AppError("Phone number is already in use by another customer", 409));
    }

    const data = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (email !== undefined) data.email = email;
    if (tags !== undefined) data.tags = Array.isArray(tags) ? tags : [];
    if (notes !== undefined) data.notes = notes;
    if (optedOut !== undefined) data.optedOut = Boolean(optedOut);

    const customer = await prisma.customer.update({
      where: { id },
      data,
    });
    res.status(200).json({ success: true, data: customer });
  } catch (err) {
    if (err.code === "P2025") return next(new AppError("Customer not found", 404));
    if (err.code === "P2002") return next(new AppError("Phone or email already in use", 409));
    next(err);
  }
};

const importCustomers = async (req, res, next) => {
  try {
    if (!req.file) return next(new AppError("CSV file is required", 400));

    let rows;
    try {
      rows = parse(req.file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true, // handle Excel-exported CSVs with BOM
      });
    } catch {
      return next(new AppError("Invalid CSV format", 400));
    }

    if (rows.length === 0) return next(new AppError("CSV file is empty", 400));
    if (rows.length > 5000) return next(new AppError("CSV cannot exceed 5000 rows per import", 400));

    let created = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 because row 1 is the header

      const phone = row.phone?.trim();
      if (!phone) {
        errors.push({ row: rowNum, reason: "Missing phone number" });
        continue;
      }

      // Parse tags: support "tag1,tag2" or "tag1;tag2"
      let tags = [];
      if (row.tags) {
        const delimiter = row.tags.includes(";") ? ";" : ",";
        tags = row.tags.split(delimiter).map((t) => t.trim()).filter(Boolean);
      }

      try {
        await prisma.customer.create({
          data: {
            name: row.name?.trim() || null,
            phone,
            email: row.email?.trim() || null,
            tags,
            notes: row.notes?.trim() || null,
          },
        });
        created++;
      } catch (err) {
        if (err.code === "P2002") {
          skipped++; // duplicate phone or email — skip silently
        } else {
          errors.push({ row: rowNum, phone, reason: err.message });
        }
      }
    }

    res.status(200).json({
      success: true,
      data: { created, skipped, errors, total: rows.length },
    });
  } catch (err) {
    next(err);
  }
};

const deleteCustomer = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.$transaction([
      prisma.message.deleteMany({ where: { conversation: { customerId: id } } }),
      prisma.conversation.deleteMany({ where: { customerId: id } }),
      prisma.campaignRecipient.deleteMany({ where: { customerId: id } }),
      prisma.customer.delete({ where: { id } }),
    ]);
    res.status(200).json({ success: true, message: "Customer deleted" });
  } catch (err) {
    if (err.code === "P2025") return next(new AppError("Customer not found", 404));
    next(err);
  }
};

// Delete many customers at once. Mirrors deleteCustomer's cascade, generalised
// with `{ in: ids }`. Capped at 5000 per request to match the import limit and
// keep the transaction bounded. Missing ids are ignored (deleteMany, not delete).
const bulkDeleteCustomers = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return next(new AppError("Provide a non-empty array of customer ids", 400));
    }
    const parsed = [...new Set(ids.map((n) => parseInt(n)).filter((n) => Number.isInteger(n)))];
    if (parsed.length === 0) return next(new AppError("No valid customer ids provided", 400));
    if (parsed.length > 5000) return next(new AppError("Cannot delete more than 5000 customers per request", 400));

    const results = await prisma.$transaction([
      prisma.message.deleteMany({ where: { conversation: { customerId: { in: parsed } } } }),
      prisma.conversation.deleteMany({ where: { customerId: { in: parsed } } }),
      prisma.campaignRecipient.deleteMany({ where: { customerId: { in: parsed } } }),
      prisma.customer.deleteMany({ where: { id: { in: parsed } } }),
    ]);
    const deleted = results[results.length - 1].count;
    res.status(200).json({ success: true, message: `Deleted ${deleted} customer(s)`, data: { deleted } });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllCustomers, getCustomerById, createCustomer, updateCustomer, importCustomers, deleteCustomer, bulkDeleteCustomers };
