const { parse } = require("csv-parse/sync");
const prisma = require("../../config/prisma");
const AppError = require("../../utils/AppError");

// ─── Patient field parsers ────────────────────────────────────────────────────

// Normalise gender input to the Prisma enum (MALE | FEMALE), or null.
function parseGender(value) {
  if (value == null || value === "") return null;
  const v = String(value).trim().toLowerCase();
  if (v === "male" || v === "m") return "MALE";
  if (v === "female" || v === "f") return "FEMALE";
  return undefined; // signal invalid
}

// Parse a date-only value (YYYY-MM-DD or any Date-parseable string) to a Date, or null.
function parseDate(value) {
  if (value == null || value === "") return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return undefined; // signal invalid
  return d;
}

// Coerce departments/tags into a trimmed string array.
function toStringArray(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  return [];
}

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
        { chartNumber: { contains: req.query.search, mode: "insensitive" } },
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
    const { name, phone, email, tags, notes, chartNumber, nationality, gender, dateOfBirth, joinDate, departments } = req.body;
    if (!phone) return next(new AppError("Phone number is required", 400));

    const genderVal = parseGender(gender);
    if (genderVal === undefined) return next(new AppError("Gender must be 'Male' or 'Female'", 400));
    const dob = parseDate(dateOfBirth);
    if (dob === undefined) return next(new AppError("Invalid date of birth", 400));
    const join = parseDate(joinDate);
    if (join === undefined) return next(new AppError("Invalid join date", 400));

    const existing = await prisma.customer.findUnique({ where: { phone } });
    if (existing) return next(new AppError("Customer with this phone already exists", 409));

    const customer = await prisma.customer.create({
      data: {
        name,
        phone,
        email: email || null,
        chartNumber: chartNumber?.trim() || null,
        nationality: nationality?.trim() || null,
        gender: genderVal,
        dateOfBirth: dob,
        joinDate: join,
        departments: toStringArray(departments),
        tags: Array.isArray(tags) ? tags : [],
        notes: notes || null,
      },
    });
    res.status(201).json({ success: true, data: customer });
  } catch (err) {
    if (err.code === "P2002") {
      const target = err.meta?.target?.join?.(", ") || "field";
      return next(new AppError(`A customer with this ${target} already exists`, 409));
    }
    next(err);
  }
};

const updateCustomer = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { name, phone, email, tags, notes, optedOut, chartNumber, nationality, gender, dateOfBirth, joinDate, departments } = req.body;

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
    if (chartNumber !== undefined) data.chartNumber = chartNumber?.trim() || null;
    if (nationality !== undefined) data.nationality = nationality?.trim() || null;
    if (gender !== undefined) {
      const genderVal = parseGender(gender);
      if (genderVal === undefined) return next(new AppError("Gender must be 'Male' or 'Female'", 400));
      data.gender = genderVal;
    }
    if (dateOfBirth !== undefined) {
      const dob = parseDate(dateOfBirth);
      if (dob === undefined) return next(new AppError("Invalid date of birth", 400));
      data.dateOfBirth = dob;
    }
    if (joinDate !== undefined) {
      const join = parseDate(joinDate);
      if (join === undefined) return next(new AppError("Invalid join date", 400));
      data.joinDate = join;
    }
    if (departments !== undefined) data.departments = toStringArray(departments);
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
    if (err.code === "P2002") {
      const target = err.meta?.target?.join?.(", ") || "field";
      return next(new AppError(`A customer with this ${target} already exists`, 409));
    }
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

      // Parse tags/departments: support "a,b" or "a;b" (ordered — first = top department)
      const splitList = (val) => {
        if (!val) return [];
        const delimiter = val.includes(";") ? ";" : ",";
        return val.split(delimiter).map((t) => t.trim()).filter(Boolean);
      };
      const tags = splitList(row.tags);
      const departments = splitList(row.departments);

      // Validate optional demographic fields per row (skip row on bad values)
      const gender = parseGender(row.gender);
      if (gender === undefined) {
        errors.push({ row: rowNum, phone, reason: "Invalid gender (use Male or Female)" });
        continue;
      }
      const dateOfBirth = parseDate(row.date_of_birth || row.dateofbirth || row.dob);
      if (dateOfBirth === undefined) {
        errors.push({ row: rowNum, phone, reason: "Invalid date of birth" });
        continue;
      }
      const joinDate = parseDate(row.join_date || row.joindate);
      if (joinDate === undefined) {
        errors.push({ row: rowNum, phone, reason: "Invalid join date" });
        continue;
      }

      try {
        await prisma.customer.create({
          data: {
            name: row.name?.trim() || null,
            phone,
            email: row.email?.trim() || null,
            chartNumber: (row.chart_number || row.chartnumber)?.trim() || null,
            nationality: row.nationality?.trim() || null,
            gender,
            dateOfBirth,
            joinDate,
            departments,
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
