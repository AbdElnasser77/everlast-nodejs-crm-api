# Admin Stats & Dashboard — Frontend Implementation Guide

## Overview

The dashboard is admin-only. It has 5 API endpoints, all under `/api/stats`.
Load all 5 in parallel when the dashboard page mounts.

All requests require the auth cookie (`credentials: "include"` / `withCredentials: true`).
Any non-admin user hitting these endpoints gets `403 Forbidden`.

---

## Base URL
```
http://localhost:8000/api/stats
```

---

## Load All at Once (parallel — do not waterfall)

```js
const [overview, messages, conversations, agents, customers] = await Promise.all([
  fetch("/api/stats/overview",       { credentials: "include" }).then(r => r.json()),
  fetch("/api/stats/messages?days=7",{ credentials: "include" }).then(r => r.json()),
  fetch("/api/stats/conversations",  { credentials: "include" }).then(r => r.json()),
  fetch("/api/stats/agents",         { credentials: "include" }).then(r => r.json()),
  fetch("/api/stats/customers?days=30",{ credentials: "include" }).then(r => r.json()),
]);
```

Each response wraps data in `{ success: true, data: { ... } }`.

---

## Endpoint 1 — `GET /api/stats/overview`

**Powers:** KPI stat cards at the top of the dashboard.

### Response
```json
{
  "success": true,
  "data": {
    "messages": {
      "today": 24,
      "last7Days": 183
    },
    "conversations": {
      "open": 12,
      "pending": 5,
      "resolved": 31,
      "unassigned": 4,
      "total": 48
    },
    "customers": {
      "total": 42,
      "newLast7Days": 8
    },
    "agents": {
      "online": 2,
      "onBreak": 1,
      "offline": 3
    },
    "unreadMessages": 37
  }
}
```

### What to render
| Field | UI Element |
|---|---|
| `messages.today` | Card: "Messages Today" |
| `messages.last7Days` | Card: "Messages This Week" |
| `conversations.open` | Card: "Open Conversations" (blue) |
| `conversations.pending` | Card: "Pending" (yellow) |
| `conversations.resolved` | Card: "Resolved" (green) |
| `conversations.unassigned` | Card: "Unassigned" — highlight red if > 0 |
| `customers.total` | Card: "Total Customers" |
| `customers.newLast7Days` | Sub-label: "+8 this week" |
| `agents.online` | Card: "Agents Online" (green dot) |
| `unreadMessages` | Badge or card: "Unread Messages" |

---

## Endpoint 2 — `GET /api/stats/messages?days=7`

**Query param:** `days` — accepts `7` or `30`. Default `7`.

**Powers:** Message volume chart + type/delivery breakdowns.

### Response
```json
{
  "success": true,
  "data": {
    "chart": [
      { "date": "2026-06-11", "incoming": 14, "outgoing": 9 },
      { "date": "2026-06-12", "incoming": 8,  "outgoing": 6 },
      { "date": "2026-06-13", "incoming": 22, "outgoing": 17 },
      { "date": "2026-06-14", "incoming": 19, "outgoing": 14 },
      { "date": "2026-06-15", "incoming": 31, "outgoing": 24 },
      { "date": "2026-06-16", "incoming": 14, "outgoing": 11 },
      { "date": "2026-06-17", "incoming": 7,  "outgoing": 5 }
    ],
    "typeBreakdown": {
      "TEXT": 142,
      "IMAGE": 18,
      "VIDEO": 4,
      "AUDIO": 7,
      "DOCUMENT": 3
    },
    "statusBreakdown": {
      "SENT": 38,
      "DELIVERED": 29,
      "READ": 22,
      "FAILED": 2
    },
    "peakHour": 14
  }
}
```

### What to render

**`chart` → Line or bar chart**
- X axis: `date`
- Two lines/bars: `incoming` (customer messages) and `outgoing` (agent messages)
- Add a toggle button "7 days / 30 days" — re-fetch with `?days=30` on toggle

**`typeBreakdown` → Donut/pie chart**
- Segments: TEXT, IMAGE, VIDEO, AUDIO, DOCUMENT
- Show count and percentage on hover

**`statusBreakdown` → Horizontal bar or progress bars (agent messages only)**
- Calculate delivery rate: `READ / (SENT + DELIVERED + READ) * 100`
- Show as: "Delivery rate: 78%"

**`peakHour` → Badge**
- Convert hour to 12h format: `14` → "Peak hour: 2 PM"
- Useful for scheduling agent shifts

---

## Endpoint 3 — `GET /api/stats/conversations`

**Powers:** Pipeline status + potential leads list + stalled conversations list.

### Response
```json
{
  "success": true,
  "data": {
    "pipeline": {
      "open": 12,
      "pending": 5,
      "resolved": 31
    },
    "avgResolutionHours": 4.2,
    "newLast7Days": [
      { "date": "2026-06-11", "count": 3 },
      { "date": "2026-06-17", "count": 2 }
    ],
    "potentialLeads": [
      {
        "conversationId": 14,
        "customerId": 9,
        "customerName": "Mohamed Ali",
        "customerPhone": "201012345678",
        "tags": ["vip"],
        "lastMessageAt": "2026-06-17T10:30:00Z",
        "waitingHours": 3.5,
        "unreadCount": 4
      }
    ],
    "stalledConversations": [
      {
        "conversationId": 7,
        "customerId": 3,
        "customerName": "Khalid Hassan",
        "customerPhone": "201098765432",
        "assignedAgent": "sara",
        "lastMessageAt": "2026-06-15T08:00:00Z",
        "waitingHours": 54,
        "status": "OPEN"
      }
    ]
  }
}
```

### What to render

**`pipeline` → Donut chart or 3-segment bar**
- OPEN = blue, PENDING = yellow, RESOLVED = green

**`avgResolutionHours` → Badge**
- "Avg resolution: 4.2 hours"
- Show `null` as "No resolved conversations yet"

**`newLast7Days` → Small bar chart**
- X = date, Y = count of new conversations that day

**`potentialLeads` → Actionable table**

These are unassigned conversations where a customer is actively waiting.

| Column | Field |
|---|---|
| Customer | `customerName` + `customerPhone` |
| Tags | `tags` as colored badges |
| Waiting | `waitingHours` + "h" — turn red if > 2 |
| Unread | `unreadCount` badge |
| Action | "Open" button → navigate to `/conversations/{conversationId}` |

- Sort by `waitingHours` descending (most urgent first)
- Empty state: "No unassigned leads right now ✓"

**`stalledConversations` → Warning table**

These are conversations where an agent is assigned but hasn't replied to the customer.

| Column | Field |
|---|---|
| Customer | `customerName` |
| Assigned to | `assignedAgent` (or "Unassigned" if null) |
| Waiting | `waitingHours` + "h" — always show in red/orange |
| Status | `status` badge |
| Action | "Open" button → `/conversations/{conversationId}` |

---

## Endpoint 4 — `GET /api/stats/agents`

**Powers:** Agent productivity leaderboard + online status summary.

### Response
```json
{
  "success": true,
  "data": {
    "statusSummary": {
      "ONLINE": 2,
      "ON_BREAK": 1,
      "OFFLINE": 3
    },
    "agents": [
      {
        "id": 2,
        "name": "Sara Ahmed",
        "username": "sara",
        "status": "ONLINE",
        "lastActiveAt": "2026-06-17T11:45:00Z",
        "assignedConversations": 5,
        "openConversations": 3,
        "messagesSentLast7Days": 48,
        "avgResponseTimeMinutes": 12
      }
    ]
  }
}
```

### What to render

**`statusSummary` → 3 small cards or a mini legend**
- ONLINE: green dot + count
- ON_BREAK: yellow dot + count
- OFFLINE: grey dot + count

**`agents` → Sortable table (default sort: `messagesSentLast7Days` desc)**

| Column | Field | Notes |
|---|---|---|
| Agent | `name` or `username` | Show status dot next to name |
| Status | `status` | Green/yellow/grey dot |
| Last Active | `lastActiveAt` | Show as relative time: "5 min ago" |
| Assigned | `assignedConversations` | Total assigned |
| Open | `openConversations` | Currently open (subset of assigned) |
| Messages (7d) | `messagesSentLast7Days` | Main productivity metric |
| Avg Response | `avgResponseTimeMinutes` | "12 min" — show `—` if null |

- Status dot colors: ONLINE = green, ON_BREAK = yellow, OFFLINE = grey
- `avgResponseTimeMinutes = null` means the agent sent no messages in the last 7 days
- Clicking a row → navigate to `/users/{id}` (agent profile)

---

## Endpoint 5 — `GET /api/stats/customers?days=30`

**Query param:** `days` — accepts `7` or `30`. Default `30`.

**Powers:** Customer growth chart + returning customers + tag distribution.

### Response
```json
{
  "success": true,
  "data": {
    "totalCustomers": 42,
    "activeCustomers": 18,
    "emailCaptureRate": 42,
    "growth": [
      { "date": "2026-06-01", "newCustomers": 3 },
      { "date": "2026-06-17", "newCustomers": 2 }
    ],
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
    ]
  }
}
```

### What to render

**`totalCustomers` / `activeCustomers` → Two stats side by side**
- "42 total customers — 18 active this week"

**`emailCaptureRate` → Progress bar**
- Label: "Email captured"
- Bar fills to `42%`
- Color: green if > 50%, yellow if 20–50%, red if < 20%

**`growth` → Area or line chart**
- X = date, Y = `newCustomers`
- Add "7 days / 30 days" toggle — re-fetch with `?days=7`

**`returningCustomers` → Table**

These are long-term customers (joined > 30 days ago) who messaged again this week.

| Column | Field | Notes |
|---|---|---|
| Customer | `name` + `phone` | |
| Tags | `tags` | Colored badges |
| Status | `conversationStatus` | OPEN/PENDING badge |
| Last Message | `lastMessageAt` | Relative time |
| Total Messages | `totalMessages` | Engagement score — higher = more loyal |

- Sort by `totalMessages` desc
- Clicking a row → `/conversations` filtered for that customer, or `/customers/{id}`

**`tagDistribution` → Horizontal bar chart or tag cloud**
- Each row: tag name + bar proportional to count
- Useful for segmenting campaigns (e.g. "14 Arabic-speaking customers")

---

## Refresh Strategy

- Load all 5 on page mount (parallel)
- Re-fetch overview every **60 seconds** (keeps KPI cards fresh)
- Re-fetch conversations (leads/stalled) every **2 minutes**
- The other 3 endpoints (messages, agents, customers) only need to refresh on manual reload or page revisit — they're historical data

```js
// Auto-refresh overview every 60s
useEffect(() => {
  const interval = setInterval(() => {
    api.get("/stats/overview").then(updateOverview);
  }, 60_000);
  return () => clearInterval(interval);
}, []);
```

---

## Errors

| Status | Meaning | What to show |
|---|---|---|
| 401 | Not logged in | Redirect to login |
| 403 | Not an admin | "Access denied" |
| 500 | Server error | "Could not load stats" with retry button |
