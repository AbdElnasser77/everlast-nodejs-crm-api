const { parse } = require("csv-parse/sync");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const prisma = require("../../config/prisma");
const AppError = require("../../utils/AppError");

// Validate & normalize a phone to WhatsApp-sendable international format (digits,
// no '+'). A number that carries its own country code is auto-detected (any
// country). A bare local number is interpreted using `country` (ISO-2, e.g.
// "AE"); with "auto" and no code the country is unknowable, so it's flagged.
// Returns { phone } on success or { error } otherwise.
function normalizeImportPhone(raw, country) {
  const s = (raw ?? "").toString().trim();
  if (!s) return { error: "Missing phone number" };
  const intl = s.replace(/^00/, "+"); // a leading 00 is the international prefix
  // A number carrying its own code auto-detects; code-less numbers fall back to
  // the chosen country, defaulting to UAE ("AE").
  const useCountry = country && country !== "auto" ? country : "AE";
  let pn;
  try { pn = parsePhoneNumberFromString(intl, useCountry); } catch { pn = null; }
  if (pn && pn.isValid()) {
    if (pn.getType() === "FIXED_LINE") return { error: "Landline — can't receive WhatsApp" };
    return { phone: pn.number.replace(/^\+/, "") };
  }
  return { error: "Invalid or unmessageable phone number" };
}

// ─── Patient field parsers ────────────────────────────────────────────────────

// Normalise gender input to the Prisma enum (MALE | FEMALE), or null.
function parseGender(value) {
  if (value == null || value === "") return null;
  const v = String(value).trim().toLowerCase();
  if (["male", "m", "man", "men", "boy", "mr", "ذكر"].includes(v)) return "MALE";
  if (["female", "f", "woman", "women", "girl", "mrs", "ms", "miss", "أنثى", "انثى"].includes(v)) return "FEMALE";
  return undefined; // signal invalid
}

// Parse a date-only value (YYYY-MM-DD or any Date-parseable string) to a Date, or null.
function parseDate(value) {
  if (value == null || value === "") return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return undefined; // signal invalid
  return d;
}

// Flexible date parser for imports. format: "auto" | "dmy" | "mdy" | "ymd".
// Returns a Date, null (empty), or undefined (unparseable). Mirrors lib/customerImport.ts.
function buildDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return dt;
}

function parseFlexibleDate(value, format = "auto") {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/); // year-first
  if (m) return buildDate(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/); // day/month then year
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3];
    if (y < 100) y += y < 50 ? 2000 : 1900;
    let day, month;
    if (format === "mdy") { month = a; day = b; }
    else if (format === "dmy") { day = a; month = b; }
    else if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { month = a; day = b; }
    else { day = a; month = b; } // prefer day-first
    return buildDate(y, month, day);
  }

  const parsed = new Date(s); // month-name formats
  if (!isNaN(parsed.getTime())) return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
  return undefined;
}

// Build a categorized import plan: validate + normalize each row, then split
// into rows to create vs. duplicates (against DB + within the file). Shared by
// the dry-run validate endpoint and the real import.
async function buildImportPlan(rows, dateFormat = "auto", defaultCountry = "") {
  const splitList = (val) => {
    if (!val) return [];
    const delimiter = val.includes(";") ? ";" : ",";
    return val.split(delimiter).map((t) => t.trim()).filter(Boolean);
  };

  const invalid = [];
  const duplicates = [];
  const candidates = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +2: row 1 is the header
    const { phone, error: phoneError } = normalizeImportPhone(row.phone, defaultCountry);
    if (phoneError) { invalid.push({ row: rowNum, phone: row.phone?.trim() || undefined, reason: phoneError }); continue; }
    const gender = parseGender(row.gender);
    if (gender === undefined) { invalid.push({ row: rowNum, phone, reason: "Invalid gender (use Male or Female)" }); continue; }
    const dateOfBirth = parseFlexibleDate(row.date_of_birth || row.dateofbirth || row.dob, dateFormat);
    if (dateOfBirth === undefined) { invalid.push({ row: rowNum, phone, reason: "Unrecognized date of birth" }); continue; }
    const joinDate = parseFlexibleDate(row.join_date || row.joindate, dateFormat);
    if (joinDate === undefined) { invalid.push({ row: rowNum, phone, reason: "Unrecognized join date" }); continue; }
    const email = row.email?.trim() || null;
    candidates.push({
      rowNum, phone, email,
      data: {
        name: row.name?.trim() || null,
        phone, email,
        chartNumber: (row.chart_number || row.chartnumber)?.trim() || null,
        nationality: row.nationality?.trim() || null,
        gender, dateOfBirth, joinDate,
        departments: splitList(row.departments),
        tags: splitList(row.tags),
        notes: row.notes?.trim() || null,
      },
    });
  }

  // Duplicates are determined by mobile (phone) and chart number only.
  const phones = [...new Set(candidates.map((c) => c.phone))];
  const charts = [...new Set(candidates.map((c) => c.data.chartNumber).filter(Boolean))];
  const existing = (phones.length || charts.length)
    ? await prisma.customer.findMany({
        where: { OR: [...(phones.length ? [{ phone: { in: phones } }] : []), ...(charts.length ? [{ chartNumber: { in: charts } }] : [])] },
        select: { phone: true, chartNumber: true },
      })
    : [];
  const existingPhones = new Set(existing.map((e) => e.phone));
  const existingCharts = new Set(existing.map((e) => e.chartNumber).filter(Boolean));

  const seenPhones = new Set();
  const seenCharts = new Set();
  const toCreate = [];
  for (const c of candidates) {
    const chart = c.data.chartNumber;
    if (existingPhones.has(c.phone)) { duplicates.push({ row: c.rowNum, phone: c.phone, reason: "Mobile already exists" }); continue; }
    if (chart && existingCharts.has(chart)) { duplicates.push({ row: c.rowNum, phone: c.phone, reason: "Chart number already exists" }); continue; }
    if (seenPhones.has(c.phone)) { duplicates.push({ row: c.rowNum, phone: c.phone, reason: "Duplicate mobile in file" }); continue; }
    if (chart && seenCharts.has(chart)) { duplicates.push({ row: c.rowNum, phone: c.phone, reason: "Duplicate chart number in file" }); continue; }
    seenPhones.add(c.phone);
    if (chart) seenCharts.add(chart);
    toCreate.push(c.data);
  }

  return { total: rows.length, invalid, duplicates, toCreate };
}

// Parse a CSV upload into row objects (shared by validate + import).
function parseUpload(req) {
  if (!req.file) throw new AppError("CSV file is required", 400);
  let rows;
  try {
    rows = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch {
    throw new AppError("Invalid CSV format", 400);
  }
  if (rows.length === 0) throw new AppError("CSV file is empty", 400);
  if (rows.length > 20000) throw new AppError("CSV cannot exceed 20000 rows per import", 400);
  return rows;
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
      // id tiebreaker keeps pagination stable when many rows share a createdAt
      // (e.g. a bulk import), otherwise skip/take can repeat or drop rows.
      prisma.customer.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: limit }),
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

// Dry-run: validate & categorize the upload without writing anything.
const validateImport = async (req, res, next) => {
  try {
    const rows = parseUpload(req);
    const plan = await buildImportPlan(rows, req.body?.dateFormat, req.body?.defaultCountry);
    res.status(200).json({
      success: true,
      data: {
        total: plan.total,
        valid: plan.toCreate.length,
        duplicates: plan.duplicates,
        invalid: plan.invalid,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Real import: categorize, then bulk-insert the valid, non-duplicate rows.
const importCustomers = async (req, res, next) => {
  try {
    const rows = parseUpload(req);
    const plan = await buildImportPlan(rows, req.body?.dateFormat, req.body?.defaultCountry);

    let created = 0;
    if (plan.toCreate.length > 0) {
      const result = await prisma.customer.createMany({ data: plan.toCreate, skipDuplicates: true });
      created = result.count;
    }
    const otherSkipped = plan.toCreate.length - created; // e.g. chart-number conflicts

    res.status(200).json({
      success: true,
      data: {
        total: plan.total,
        created,
        skipped: plan.duplicates.length + otherSkipped,
        duplicates: plan.duplicates,
        errors: plan.invalid,
      },
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

module.exports = { getAllCustomers, getCustomerById, createCustomer, updateCustomer, validateImport, importCustomers, deleteCustomer, bulkDeleteCustomers };
