# User Management — API Reference

## Overview

Admins have full control over agent accounts. Agents can manage their own profile and status.

**Base URL:** `http://localhost:8000/api`
**Auth:** All endpoints require `Authorization: Bearer <token>`

---

## Data Model

```ts
User {
  id: number
  name: string | null           // display name
  username: string              // unique, used for login
  role: "ADMIN" | "AGENT"
  status: "ONLINE" | "OFFLINE" | "ON_BREAK"
  lastActiveAt: string | null   // ISO datetime, auto-updates on every API request
  createdAt: string
  updatedAt: string
  _count?: {                    // only returned on /me and /:id
    messages: number
    assignedConversations: number
  }
}
```

---

## Self-Service (any logged-in user)

### Get own profile
```
GET /api/users/me
```
**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Ahmed Admin",
    "username": "admin",
    "role": "ADMIN",
    "status": "ONLINE",
    "lastActiveAt": "2026-06-16T15:30:00.000Z",
    "createdAt": "2026-06-01T09:00:00.000Z",
    "updatedAt": "2026-06-16T15:30:00.000Z",
    "_count": {
      "messages": 42,
      "assignedConversations": 5
    }
  }
}
```

### Update own status
```
PUT /api/users/me/status
Body: { "status": "ON_BREAK" }
```
Valid values: `ONLINE` | `OFFLINE` | `ON_BREAK`

**Response 200:**
```json
{ "success": true, "data": { ...user object } }
```

### Change own password
```
PUT /api/users/me/password
Body: { "currentPassword": "OldPass123", "newPassword": "NewPass456" }
```
- `newPassword` minimum 8 characters
- Returns `401` if `currentPassword` is wrong

**Response 200:**
```json
{ "success": true, "message": "Password changed successfully" }
```

---

## Admin Only

All endpoints below return `403` if the logged-in user is not `ADMIN`.

### List all users
```
GET /api/users?page=1&limit=20&search=sara&role=AGENT&status=ONLINE
```
Query params (all optional):
- `search` — matches name or username
- `role` — `ADMIN` | `AGENT`
- `status` — `ONLINE` | `OFFLINE` | `ON_BREAK`
- `page` — default 1
- `limit` — default 20, max 100

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 2,
      "name": "Sara Ali",
      "username": "sara",
      "role": "AGENT",
      "status": "ONLINE",
      "lastActiveAt": "2026-06-16T15:28:00.000Z",
      "createdAt": "2026-06-05T10:00:00.000Z",
      "updatedAt": "2026-06-16T15:28:00.000Z"
    }
  ],
  "pagination": {
    "total": 5,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

### Get single user with stats
```
GET /api/users/:id
```
**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 2,
    "name": "Sara Ali",
    "username": "sara",
    "role": "AGENT",
    "status": "ONLINE",
    "lastActiveAt": "2026-06-16T15:28:00.000Z",
    "createdAt": "2026-06-05T10:00:00.000Z",
    "updatedAt": "2026-06-16T15:28:00.000Z",
    "_count": {
      "messages": 120,
      "assignedConversations": 8
    }
  }
}
```

### Create a new agent
```
POST /api/users
```
**Body:**
```json
{
  "name": "Sara Ali",
  "username": "sara",
  "password": "SecurePass1",
  "role": "AGENT"
}
```
- `username` and `password` required
- `password` minimum 8 characters
- `name` optional
- `role` defaults to `AGENT`

**Response 201:**
```json
{ "success": true, "data": { ...user object } }
```
**Response 409:** Username already taken.

### Update a user
```
PUT /api/users/:id
```
All fields optional. Only provided fields are updated.

**Body:**
```json
{
  "name": "Sara Mohamed",
  "username": "sara_m",
  "role": "ADMIN",
  "status": "OFFLINE"
}
```
**Response 200:**
```json
{ "success": true, "data": { ...updated user object } }
```

### Reset a user's password
```
PUT /api/users/:id/password
Body: { "password": "NewSecurePass1" }
```
- Admin does NOT need the current password
- Minimum 8 characters

**Response 200:**
```json
{ "success": true, "message": "Password reset successfully" }
```

### Delete a user
```
DELETE /api/users/:id
```
- Cannot delete your own account (returns `400`)

**Response 200:**
```json
{ "success": true, "message": "User deleted" }
```

---

## Error Responses

```json
{ "success": false, "message": "User not found" }
```

| Status | Meaning |
|---|---|
| `400` | Missing field, invalid value, or trying to delete own account |
| `401` | Wrong current password |
| `403` | Not an ADMIN |
| `404` | User not found |
| `409` | Username already taken |
