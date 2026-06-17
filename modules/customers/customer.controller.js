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
    const { name, phone, email, tags, notes } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (email !== undefined) data.email = email;
    if (tags !== undefined) data.tags = Array.isArray(tags) ? tags : [];
    if (notes !== undefined) data.notes = notes;

    const customer = await prisma.customer.update({
      where: { id: parseInt(req.params.id) },
      data,
    });
    res.status(200).json({ success: true, data: customer });
  } catch (err) {
    if (err.code === "P2025") return next(new AppError("Customer not found", 404));
    if (err.code === "P2002") return next(new AppError("Email already in use", 409));
    next(err);
  }
};

module.exports = { getAllCustomers, getCustomerById, createCustomer, updateCustomer };
