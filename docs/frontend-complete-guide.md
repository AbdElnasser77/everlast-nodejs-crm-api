# Everlast CRM — Complete Frontend Integration Guide

## Backend Base URL
```
http://localhost:8000
```

All API calls go to `/api/*`.  
Socket.IO connects to the root: `http://localhost:8000`.

---

## 1. Global Setup

### Axios instance (use this for every API call)
```js
// lib/api.js
import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:8000/api",
  withCredentials: true, // REQUIRED — sends the HttpOnly auth cookie automatically
});

// Redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;
```

### Socket.IO instance (singleton)
```js
// lib/socket.js
import { io } from "socket.io-client";

const socket = io("http://localhost:8000", {
  withCredentials: true,
  autoConnect: false, // connect manually after login
});

export default socket;
```

Connect after login:
```js
import socket from "@/lib/socket";
socket.connect();
```

Disconnect on logout:
```js
socket.disconnect();
```

---

## 2. Auth

### Login
```
POST /api/auth/login
Body: { username, password }
```
```js
const { data } = await api.post("/auth/login", { username, password });
// data.user = { id, name, username, role, status }
// Cookie is set automatically by the browser — do NOT store a token
localStorage.setItem("user", JSON.stringify(data.user));
socket.connect(); // start real-time
```

### Logout
```
POST /api/auth/logout
```
```js
await api.post("/auth/logout");
localStorage.removeItem("user");
socket.disconnect();
// redirect to /login
```

### Auth guard (protect routes)
```js
const user = JSON.parse(localStorage.getItem("user") || "null");
if (!user) redirect("/login");
if (user.role !== "ADMIN" && adminOnlyPage) redirect("/");
```

---

## 3. Conversations

### List (with filters)
```
GET /api/conversations?page=1&limit=20&status=OPEN&assignedAgentId=2
```
```js
const { data } = await api.get("/conversations", {
  params: { page, limit, status, assignedAgentId },
});
// data.data[] = conversation objects
// data.pagination = { total, page, limit, totalPages }
```

**Conversation object shape:**
```json
{
  "id": 1,
  "status": "OPEN",
  "unreadCount": 3,
  "lastMessage": "Hello",
  "lastMessageAt": "2026-06-17T...",
  "lastSenderType": "CUSTOMER",
  "customer": { "name": "Mohamed", "phone": "201012345678" },
  "assignedAgent": { "id": 2, "username": "sara" }
}
```

### Get messages in a conversation (paginated, oldest last)
```
GET /api/conversations/:id/messages?page=1&limit=50
```
```js
const { data } = await api.get(`/conversations/${id}/messages`, {
  params: { page: 1, limit: 50 },
});
```

### Mark as read
```
POST /api/conversations/:id/read
```
```js
await api.post(`/conversations/${id}/read`);
```

### Assign to agent
```
PUT /api/conversations/:id/assign
Body: { agentId }  ← pass null to unassign
```
```js
await api.put(`/conversations/${id}/assign`, { agentId });
```

### Change status
```
PUT /api/conversations/:id/status
Body: { status }  ← "OPEN" | "PENDING" | "RESOLVED"
```
```js
await api.put(`/conversations/${id}/status`, { status });
```

---

## 4. Messages

### Send a text message
```
POST /api/messages/send
Body: { conversationId, content, messageType: "TEXT" }
```
```js
const { data } = await api.post("/messages/send", {
  conversationId,
  content,
  messageType: "TEXT",
});
// data.data = saved message object
```

### Send a media message (2-step)
```js
// Step 1 — upload file
const formData = new FormData();
formData.append("file", file); // File from input

const { data: upload } = await api.post("/media/upload", formData, {
  headers: { "Content-Type": undefined }, // let browser set multipart boundary
});
// upload = { url, messageType, format, bytes }

// Step 2 — send
const { data } = await api.post("/messages/send", {
  conversationId,
  messageType: upload.messageType,
  mediaUrl: upload.url,
  content: caption || "", // optional caption
});
```

### Search messages
```
GET /api/messages/search?q=hello&conversationId=1&page=1&limit=20
```
```js
const { data } = await api.get("/messages/search", {
  params: { q, conversationId, page, limit },
});
```

### Render a message (component logic)
```js
// For TEXT: render message.content as text
// For media from AGENT: message.content is the Cloudinary URL — use directly as src
// For media from CUSTOMER: must fetch through backend proxy

async function getMediaSrc(messageId) {
  // credentials are sent automatically via withCredentials on the axios instance
  // BUT for <img src="..."> tags, use this fetch-to-blob approach instead:
  const res = await fetch(`http://localhost:8000/api/messages/${messageId}/media`, {
    credentials: "include",
  });
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
```

**Render logic:**
```jsx
function Message({ message }) {
  const isAgentMedia = message.senderType === "AGENT" && message.messageType !== "TEXT";
  const isCustomerMedia = message.senderType === "CUSTOMER" && message.messageType !== "TEXT";

  const [src, setSrc] = useState(isAgentMedia ? message.content : null);

  useEffect(() => {
    if (isCustomerMedia) {
      getMediaSrc(message.id).then(setSrc);
    }
  }, [message.id]);

  if (message.messageType === "TEXT") return <p>{message.content}</p>;
  if (!src) return <span>Loading...</span>;
  if (message.messageType === "IMAGE") return <img src={src} style={{ maxWidth: 300 }} />;
  if (message.messageType === "VIDEO") return <video controls src={src} style={{ maxWidth: 300 }} />;
  if (message.messageType === "AUDIO") return <audio controls src={src} />;
  if (message.messageType === "DOCUMENT") return <a href={src} download>📄 Download</a>;
}
```

---

## 5. Customers

### List (paginated + search)
```
GET /api/customers?page=1&limit=20&search=john
```
```js
const { data } = await api.get("/customers", { params: { page, limit, search } });
```

### Get one
```
GET /api/customers/:id
```

### Create
```
POST /api/customers
Body: { name, phone, email?, tags?: ["vip"], notes? }
```

### Update
```
PUT /api/customers/:id
Body: any subset of { name, phone, email, tags, notes }
```

---

## 6. Users (ADMIN only)

### List agents
```
GET /api/users?page=1&limit=20&role=AGENT&status=ONLINE&search=sara
```
```js
const { data } = await api.get("/users", {
  params: { page, limit, role, status, search },
});
```

**User object shape:**
```json
{
  "id": 2,
  "name": "Sara Ahmed",
  "username": "sara",
  "role": "AGENT",
  "status": "ONLINE",
  "lastActiveAt": "2026-06-17T11:45:00Z",
  "createdAt": "2026-06-01T..."
}
```

### Get one (includes message + conversation counts)
```
GET /api/users/:id
```
```js
// response includes:
// _count: { messages: 142, assignedConversations: 12 }
```

### Create user (ADMIN)
```
POST /api/users
Body: { name, username, password, role: "AGENT" | "ADMIN" }
```

### Update user (ADMIN)
```
PUT /api/users/:id
Body: any subset of { name, username, role }
```

### Reset password (ADMIN)
```
PUT /api/users/:id/password
Body: { newPassword }
```

### Delete user (ADMIN)
```
DELETE /api/users/:id
```

### Own profile (any logged-in user)
```
GET /api/users/me
PUT /api/users/me/status    Body: { status: "ONLINE" | "OFFLINE" | "ON_BREAK" }
PUT /api/users/me/password  Body: { currentPassword, newPassword }
```

---

## 7. Stats & Dashboard (ADMIN only)

All 5 endpoints can be called in parallel on dashboard load:

```js
const [overview, messages, conversations, agents, customers] = await Promise.all([
  api.get("/stats/overview"),
  api.get("/stats/messages", { params: { days: 7 } }),
  api.get("/stats/conversations"),
  api.get("/stats/agents"),
  api.get("/stats/customers", { params: { days: 30 } }),
]);
```

### `/stats/overview` — KPI cards
```json
{
  "messages":      { "today": 24, "last7Days": 183 },
  "conversations": { "open": 12, "pending": 5, "resolved": 31, "unassigned": 4, "total": 48 },
  "customers":     { "total": 42, "newLast7Days": 8 },
  "agents":        { "online": 2, "onBreak": 1, "offline": 3 },
  "unreadMessages": 37
}
```

**Use for:** stat cards at the top of the dashboard.

---

### `/stats/messages?days=7` — Message chart
```json
{
  "chart": [
    { "date": "2026-06-11", "incoming": 14, "outgoing": 9 }
  ],
  "typeBreakdown":   { "TEXT": 142, "IMAGE": 18, "AUDIO": 7 },
  "statusBreakdown": { "SENT": 38, "DELIVERED": 29, "READ": 22, "FAILED": 2 },
  "peakHour": 14
}
```

**Use for:**
- Line/bar chart: X = date, two lines = incoming vs outgoing
- Donut chart: message type distribution
- Delivery rate: `READ / (SENT + DELIVERED + READ)` × 100
- Peak hour badge: "Most active at 2 PM"

---

### `/stats/conversations` — Pipeline + Leads
```json
{
  "pipeline": { "open": 12, "pending": 5, "resolved": 31 },
  "avgResolutionHours": 4.2,
  "newLast7Days": [{ "date": "2026-06-11", "count": 3 }],
  "potentialLeads": [
    {
      "conversationId": 14,
      "customerName": "Mohamed Ali",
      "customerPhone": "201012345678",
      "tags": ["vip"],
      "waitingHours": 3.5,
      "unreadCount": 4
    }
  ],
  "stalledConversations": [
    {
      "conversationId": 7,
      "assignedAgent": "sara",
      "waitingHours": 54,
      "status": "OPEN"
    }
  ]
}
```

**Use for:**
- Donut/pie: OPEN / PENDING / RESOLVED
- `avgResolutionHours` badge: "Avg 4.2h to resolve"
- **Potential Leads table** — clickable rows → opens the conversation. Show `waitingHours` with a warning color if >2h
- **Stalled table** — conversations where agent hasn't replied. Show who it's assigned to and how long they've been waiting

---

### `/stats/agents` — Leaderboard
```json
{
  "agents": [
    {
      "id": 2,
      "username": "sara",
      "status": "ONLINE",
      "lastActiveAt": "2026-06-17T11:45:00Z",
      "assignedConversations": 5,
      "openConversations": 3,
      "messagesSentLast7Days": 48,
      "avgResponseTimeMinutes": 12
    }
  ],
  "statusSummary": { "ONLINE": 2, "ON_BREAK": 1, "OFFLINE": 3 }
}
```

**Use for:**
- Agent table sorted by `messagesSentLast7Days` desc
- Status dot (green = ONLINE, yellow = ON_BREAK, grey = OFFLINE)
- `avgResponseTimeMinutes` — show as "12 min avg response"
- `lastActiveAt` — show as "Last seen 5 min ago"

---

### `/stats/customers?days=30` — Customer insights
```json
{
  "growth": [{ "date": "2026-06-01", "newCustomers": 3 }],
  "returningCustomers": [
    {
      "id": 5,
      "name": "Khalid Hassan",
      "phone": "201098765432",
      "tags": ["arabic", "vip"],
      "conversationStatus": "OPEN",
      "lastMessageAt": "2026-06-17T09:00:00Z",
      "totalMessages": 34
    }
  ],
  "tagDistribution": [
    { "tag": "vip", "count": 8 },
    { "tag": "arabic", "count": 14 }
  ],
  "emailCaptureRate": 42,
  "totalCustomers": 42,
  "activeCustomers": 18
}
```

**Use for:**
- Area/line chart: new customers per day
- **Returning customers list** — highlight loyal customers, show `totalMessages` as engagement score
- Tag bar chart or tag cloud
- `emailCaptureRate` progress bar: "42% have email"
- Active vs total: "18 of 42 active this week"

---

## 8. Real-time — Socket.IO Events

### Events to listen for (server → frontend)

```js
// New message received or sent
socket.on("message.created", ({ message, conversationId }) => {
  // append message to the open conversation
  // if conversation is not open, increment the badge count
});

// Conversation list needs refresh
socket.on("conversation.updated", ({ conversationId }) => {
  // re-fetch or update lastMessage, unreadCount for that conversation in the list
});

// Conversation assigned/unassigned
socket.on("conversation.assigned", ({ conversationId, agentId, agentUsername }) => {
  // update assignedAgent on that conversation card
});

// Conversation status changed
socket.on("conversation.status_changed", ({ conversationId, status }) => {
  // update status badge on conversation card
  // optionally remove from list if filtering by status
});

// Outgoing message delivery status updated
socket.on("message.status_updated", ({ messageId, status }) => {
  // update the tick/status indicator on that message
  // status: "SENT" | "DELIVERED" | "READ" | "FAILED"
});

// Typing indicators
socket.on("typing.start", ({ conversationId, username }) => {
  // show "sara is typing..." if conversationId matches open conversation
});

socket.on("typing.stop", ({ conversationId, username }) => {
  // hide typing indicator
});
```

### Events to emit (frontend → server)

```js
// While agent is typing
let typingTimer;
inputEl.addEventListener("input", () => {
  socket.emit("typing.start", { conversationId, username: currentUser.username });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit("typing.stop", { conversationId, username: currentUser.username });
  }, 2000);
});
```

---

## 9. Recommended Page Structure

```
/login                    — Auth page
/dashboard                — Admin only. Stats overview + charts + leads
/conversations            — Full conversation list with filters
/conversations/:id        — Chat view with messages + customer info panel
/customers                — Customer list with search
/customers/:id            — Customer profile + conversation history
/users                    — Admin only. Agent list with status
/users/:id                — Admin only. Agent profile + edit
```

### Dashboard page load order (parallel)
```js
// Load all stat blocks at once — do not waterfall these
Promise.all([
  api.get("/stats/overview"),
  api.get("/stats/messages?days=7"),
  api.get("/stats/conversations"),
  api.get("/stats/agents"),
  api.get("/stats/customers?days=30"),
]).then(([overview, messages, convs, agents, customers]) => {
  // render each section as its data arrives (use React Suspense or individual loading states)
});
```

### Conversation page load order
```js
// 1. Load conversation list (left panel)
// 2. When user clicks a conversation:
await Promise.all([
  api.get(`/conversations/${id}/messages`), // messages
  api.post(`/conversations/${id}/read`),    // mark read simultaneously
]);
```

---

## 10. Error Handling

All API errors follow this shape:
```json
{ "success": false, "message": "Human readable error" }
```

| Status | Meaning |
|---|---|
| 400 | Bad request — missing or invalid field. Show `error.response.data.message` to user |
| 401 | Not logged in — redirect to `/login` (handled by axios interceptor above) |
| 403 | Not authorized (agent tried admin route) — show "Access denied" |
| 404 | Resource not found |
| 409 | Duplicate (phone/email already exists) — show inline field error |
| 413 | File too large (>16MB) |
| 502 | External API error (Meta or Cloudinary) — show "Try again later" |
| 500 | Server error — show generic "Something went wrong" |

---

## 11. Status Colors (UI convention)

### Conversation status
| Value | Color |
|---|---|
| `OPEN` | Blue |
| `PENDING` | Yellow/Amber |
| `RESOLVED` | Green |

### Agent status
| Value | Color |
|---|---|
| `ONLINE` | Green dot |
| `ON_BREAK` | Yellow dot |
| `OFFLINE` | Grey dot |

### Message delivery status
| Value | Icon |
|---|---|
| `PENDING` | Clock icon |
| `SENT` | Single tick |
| `DELIVERED` | Double tick (grey) |
| `READ` | Double tick (blue) |
| `FAILED` | Red X |
