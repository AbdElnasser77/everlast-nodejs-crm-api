const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Everlast CRM API",
      version: "2.0.0",
      description: "WhatsApp CRM backend for Everlast Wellness",
    },
    servers: [{ url: "http://localhost:8000/api" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        LoginRequest: {
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string", example: "admin" },
            password: { type: "string", example: "Admin@1234" },
          },
        },
        LoginResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            token: { type: "string" },
            user: {
              type: "object",
              properties: {
                id: { type: "integer" },
                username: { type: "string" },
                role: { type: "string", enum: ["ADMIN", "AGENT"] },
              },
            },
          },
        },
        User: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string", nullable: true },
            username: { type: "string" },
            role: { type: "string", enum: ["ADMIN", "AGENT"] },
            status: { type: "string", enum: ["ONLINE", "OFFLINE", "ON_BREAK"] },
            lastActiveAt: { type: "string", format: "date-time", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        Customer: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string", nullable: true },
            phone: { type: "string" },
            email: { type: "string", nullable: true },
            tags: { type: "array", items: { type: "string" } },
            notes: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Conversation: {
          type: "object",
          properties: {
            id: { type: "integer" },
            customerId: { type: "integer" },
            customer: {
              type: "object",
              properties: {
                name: { type: "string", nullable: true },
                phone: { type: "string" },
              },
            },
            assignedAgentId: { type: "integer", nullable: true },
            assignedAgent: {
              type: "object",
              nullable: true,
              properties: {
                id: { type: "integer" },
                username: { type: "string" },
              },
            },
            status: { type: "string", enum: ["OPEN", "PENDING", "RESOLVED"] },
            unreadCount: { type: "integer" },
            lastMessage: { type: "string", nullable: true },
            lastMessageAt: { type: "string", format: "date-time", nullable: true },
            lastSenderType: { type: "string", enum: ["CUSTOMER", "AGENT"], nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        Message: {
          type: "object",
          properties: {
            id: { type: "integer" },
            conversationId: { type: "integer" },
            senderType: { type: "string", enum: ["CUSTOMER", "AGENT"] },
            senderId: { type: "integer", nullable: true },
            content: { type: "string" },
            messageType: { type: "string", enum: ["TEXT", "IMAGE", "VIDEO", "AUDIO", "DOCUMENT"] },
            whatsappMessageId: { type: "string", nullable: true },
            status: { type: "string", enum: ["PENDING", "SENT", "DELIVERED", "READ", "FAILED"], nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        AuditLog: {
          type: "object",
          properties: {
            id: { type: "integer" },
            action: { type: "string" },
            actorId: { type: "integer", nullable: true },
            actorUsername: { type: "string", nullable: true },
            targetType: { type: "string" },
            targetId: { type: "integer" },
            details: { type: "object", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Pagination: {
          type: "object",
          properties: {
            total: { type: "integer" },
            page: { type: "integer" },
            limit: { type: "integer" },
            totalPages: { type: "integer" },
          },
        },
        Error: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/users": {
        get: {
          tags: ["Users"],
          summary: "List all users — ADMIN only",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "search", in: "query", schema: { type: "string" }, description: "Search by name or username" },
            { name: "role", in: "query", schema: { type: "string", enum: ["ADMIN", "AGENT"] } },
            { name: "status", in: "query", schema: { type: "string", enum: ["ONLINE", "OFFLINE", "ON_BREAK"] } },
          ],
          responses: {
            200: { description: "List of users", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/User" } }, pagination: { $ref: "#/components/schemas/Pagination" } } } } } },
            403: { description: "ADMIN only" },
          },
        },
        post: {
          tags: ["Users"],
          summary: "Create a new agent — ADMIN only",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["username", "password"],
                  properties: {
                    name: { type: "string", example: "Sara Ali" },
                    username: { type: "string", example: "sara" },
                    password: { type: "string", example: "SecurePass1" },
                    role: { type: "string", enum: ["ADMIN", "AGENT"], default: "AGENT" },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "User created", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/User" } } } } } },
            409: { description: "Username already taken" },
          },
        },
      },
      "/users/me": {
        get: {
          tags: ["Users"],
          summary: "Get own profile",
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Own profile", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/User" } } } } } },
          },
        },
      },
      "/users/me/status": {
        put: {
          tags: ["Users"],
          summary: "Update own status (go online, offline, or on break)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["status"], properties: { status: { type: "string", enum: ["ONLINE", "OFFLINE", "ON_BREAK"] } } } } },
          },
          responses: {
            200: { description: "Status updated" },
          },
        },
      },
      "/users/me/password": {
        put: {
          tags: ["Users"],
          summary: "Change own password",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["currentPassword", "newPassword"], properties: { currentPassword: { type: "string" }, newPassword: { type: "string", minLength: 8 } } } } },
          },
          responses: {
            200: { description: "Password changed" },
            401: { description: "Current password incorrect" },
          },
        },
      },
      "/users/{id}": {
        get: {
          tags: ["Users"],
          summary: "Get single user with stats — ADMIN only",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: { description: "User found" },
            404: { description: "User not found" },
          },
        },
        put: {
          tags: ["Users"],
          summary: "Update user (name, username, role, status) — ADMIN only",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    username: { type: "string" },
                    role: { type: "string", enum: ["ADMIN", "AGENT"] },
                    status: { type: "string", enum: ["ONLINE", "OFFLINE", "ON_BREAK"] },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "User updated" },
            404: { description: "User not found" },
          },
        },
        delete: {
          tags: ["Users"],
          summary: "Delete a user — ADMIN only",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: { description: "User deleted" },
            400: { description: "Cannot delete own account" },
            404: { description: "User not found" },
          },
        },
      },
      "/users/{id}/password": {
        put: {
          tags: ["Users"],
          summary: "Reset any user's password — ADMIN only",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["password"], properties: { password: { type: "string", minLength: 8, example: "NewPass123" } } } } },
          },
          responses: {
            200: { description: "Password reset" },
            404: { description: "User not found" },
          },
        },
      },
      "/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Login and get JWT token",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } },
          },
          responses: {
            200: { description: "Login successful", content: { "application/json": { schema: { $ref: "#/components/schemas/LoginResponse" } } } },
            401: { description: "Invalid credentials", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/customers": {
        get: {
          tags: ["Customers"],
          summary: "Get all customers (paginated)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "search", in: "query", schema: { type: "string" }, description: "Search by name, phone, or email" },
          ],
          responses: {
            200: { description: "List of customers", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/Customer" } }, pagination: { $ref: "#/components/schemas/Pagination" } } } } } },
            401: { description: "Unauthorized" },
          },
        },
        post: {
          tags: ["Customers"],
          summary: "Create a new customer",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["phone"],
                  properties: {
                    name: { type: "string", example: "John Doe" },
                    phone: { type: "string", example: "201012345678" },
                    email: { type: "string", example: "john@example.com" },
                    tags: { type: "array", items: { type: "string" }, example: ["vip", "arabic"] },
                    notes: { type: "string", example: "Prefers morning calls" },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "Customer created", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/Customer" } } } } } },
            409: { description: "Duplicate phone or email" },
          },
        },
      },
      "/customers/{id}": {
        get: {
          tags: ["Customers"],
          summary: "Get a single customer by ID",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: { description: "Customer found", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/Customer" } } } } } },
            404: { description: "Customer not found" },
          },
        },
        put: {
          tags: ["Customers"],
          summary: "Update a customer",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    phone: { type: "string" },
                    email: { type: "string" },
                    tags: { type: "array", items: { type: "string" } },
                    notes: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Customer updated", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/Customer" } } } } } },
            404: { description: "Customer not found" },
          },
        },
      },
      "/conversations": {
        get: {
          tags: ["Conversations"],
          summary: "Get all conversations (paginated, sorted by latest message)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "status", in: "query", schema: { type: "string", enum: ["OPEN", "PENDING", "RESOLVED"] }, description: "Filter by status" },
            { name: "assignedAgentId", in: "query", schema: { type: "integer" }, description: "Filter by assigned agent ID" },
          ],
          responses: {
            200: { description: "List of conversations", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/Conversation" } }, pagination: { $ref: "#/components/schemas/Pagination" } } } } } },
          },
        },
      },
      "/conversations/{id}/messages": {
        get: {
          tags: ["Conversations"],
          summary: "Get messages in a conversation",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" }, description: "Conversation ID" },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          ],
          responses: {
            200: { description: "Messages list", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/Message" } }, pagination: { $ref: "#/components/schemas/Pagination" } } } } } },
            404: { description: "Conversation not found" },
          },
        },
      },
      "/conversations/{id}/read": {
        post: {
          tags: ["Conversations"],
          summary: "Mark conversation as read (reset unreadCount to 0)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: { description: "Marked as read" },
            404: { description: "Conversation not found" },
          },
        },
      },
      "/conversations/{id}/assign": {
        put: {
          tags: ["Conversations"],
          summary: "Assign conversation to an agent",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    agentId: { type: "integer", nullable: true, example: 2, description: "Agent user ID. Pass null to unassign." },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Conversation assigned", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/Conversation" } } } } } },
            404: { description: "Conversation or agent not found" },
          },
        },
      },
      "/conversations/{id}/status": {
        put: {
          tags: ["Conversations"],
          summary: "Change conversation status",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status"],
                  properties: {
                    status: { type: "string", enum: ["OPEN", "PENDING", "RESOLVED"] },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Status updated", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/Conversation" } } } } } },
            400: { description: "Invalid status value" },
            404: { description: "Conversation not found" },
          },
        },
      },
      "/messages/send": {
        post: {
          tags: ["Messages"],
          summary: "Send a WhatsApp message to a customer",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["conversationId", "content"],
                  properties: {
                    conversationId: { type: "integer", example: 1 },
                    content: { type: "string", example: "Hello! How can I help you?" },
                    messageType: { type: "string", enum: ["TEXT"], default: "TEXT" },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "Message sent and saved", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/Message" } } } } } },
            400: { description: "Missing required fields" },
            404: { description: "Conversation not found" },
          },
        },
      },
      "/messages/search": {
        get: {
          tags: ["Messages"],
          summary: "Search messages by content",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" }, description: "Search term" },
            { name: "conversationId", in: "query", schema: { type: "integer" }, description: "Scope search to a specific conversation (optional)" },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          ],
          responses: {
            200: { description: "Matching messages", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/Message" } }, pagination: { $ref: "#/components/schemas/Pagination" } } } } } },
            400: { description: "Missing search query" },
          },
        },
      },
      "/audit": {
        get: {
          tags: ["Audit"],
          summary: "Get audit log (ADMIN only)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "action", in: "query", schema: { type: "string" }, description: "Filter by action name (partial match)" },
            { name: "actorId", in: "query", schema: { type: "integer" }, description: "Filter by actor user ID" },
          ],
          responses: {
            200: { description: "Audit log entries", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/AuditLog" } }, pagination: { $ref: "#/components/schemas/Pagination" } } } } } },
            403: { description: "Forbidden — ADMIN role required" },
          },
        },
      },
    },
  },
  apis: [],
};

module.exports = swaggerJsdoc(options);
