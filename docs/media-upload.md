# Media Upload & Display — Frontend Integration Guide

## Overview

Agents can send images, videos, audio, and documents to customers via WhatsApp.
Customers can also send media back — the backend saves and proxies it.

---

## Base URL
```
http://localhost:8000
```

All requests require the auth cookie (set automatically by the browser after login).
Always include `credentials: "include"` on every fetch call.

---

## Part 1 — Sending Media (Agent → Customer)

### How it works
1. Agent picks a file
2. Frontend uploads it to `/api/media/upload` → gets back a Cloudinary URL
3. Frontend sends that URL to `/api/messages/send`
4. Backend delivers it to the customer on WhatsApp

### Step 1 — Upload the file

```
POST /api/media/upload
Content-Type: multipart/form-data
Field name: "file"
```

**Supported file types:**
| Type | Formats |
|---|---|
| Image | jpg, png, gif, webp |
| Video | mp4, 3gp |
| Audio | aac, mp3, ogg, opus, amr |
| Document | pdf, doc, docx, xls, xlsx |

**Max size:** 16MB

**Request:**
```js
const formData = new FormData();
formData.append("file", file); // File object from input or drag-and-drop

const res = await fetch("http://localhost:8000/api/media/upload", {
  method: "POST",
  credentials: "include",
  body: formData,
  // ⚠️ Do NOT set Content-Type header manually — browser sets it with boundary
});

const data = await res.json();
```

**Response 200:**
```json
{
  "success": true,
  "url": "https://res.cloudinary.com/dnlyiz5ck/image/upload/v.../everlast-crm/filename.jpg",
  "publicId": "everlast-crm/filename",
  "messageType": "IMAGE",
  "format": "jpg",
  "bytes": 204800
}
```

`messageType` is auto-detected from the file type:
- Image file → `"IMAGE"`
- Video file → `"VIDEO"`
- Audio file → `"AUDIO"`
- PDF/Word/Excel → `"DOCUMENT"`

---

### Step 2 — Send the message

```
POST /api/messages/send
Content-Type: application/json
```

```js
const res = await fetch("http://localhost:8000/api/messages/send", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    conversationId: 5,           // required
    messageType: "IMAGE",        // from upload response
    mediaUrl: "https://res.cloudinary.com/...", // from upload response
    content: "Check this out",   // optional caption (ignored for AUDIO)
  }),
});

const { data: message } = await res.json();
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": 110,
    "conversationId": 5,
    "senderType": "AGENT",
    "senderId": 1,
    "content": "https://res.cloudinary.com/...",
    "messageType": "IMAGE",
    "status": "SENT",
    "createdAt": "2026-06-17T..."
  }
}
```

---

### Complete send flow (copy-paste ready)

```js
async function sendMediaMessage(conversationId, file, caption = "") {
  // Step 1: upload
  const formData = new FormData();
  formData.append("file", file);

  const uploadRes = await fetch("http://localhost:8000/api/media/upload", {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!uploadRes.ok) throw new Error("Upload failed");
  const { url, messageType } = await uploadRes.json();

  // Step 2: send
  const sendRes = await fetch("http://localhost:8000/api/messages/send", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId,
      messageType,
      mediaUrl: url,
      content: caption,
    }),
  });

  if (!sendRes.ok) throw new Error("Send failed");
  return sendRes.json();
}
```

---

### UI — File picker in the chat input

Add a paperclip button next to the text input:

```html
<!-- Hidden file input -->
<input
  type="file"
  id="mediaInput"
  style="display: none"
  accept="image/*,video/mp4,video/3gpp,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
/>

<!-- Visible button -->
<button type="button" onclick="document.getElementById('mediaInput').click()">
  📎
</button>
```

```js
document.getElementById("mediaInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // Show loading state
  setUploading(true);

  try {
    await sendMediaMessage(currentConversationId, file);
  } catch (err) {
    alert("Failed to send file: " + err.message);
  } finally {
    setUploading(false);
    e.target.value = ""; // reset input so same file can be sent again
  }
});
```

---

## Part 2 — Displaying Media (Incoming + Outgoing)

### The problem with `<img src="...">` for received media

Received media (from customers) is proxied through your backend at:
```
GET /api/messages/:id/media
```

This endpoint requires authentication. A plain `<img src="...">` won't send the auth cookie cross-origin. You must fetch it with credentials and use a blob URL.

**This only applies to customer-sent media.** Agent-sent media has a Cloudinary URL that's public — you can use it directly as `src`.

---

### Helper — load media with auth

```js
const mediaCache = new Map(); // cache so each message only fetches once

async function getAuthenticatedMediaUrl(messageId) {
  if (mediaCache.has(messageId)) return mediaCache.get(messageId);

  const res = await fetch(`http://localhost:8000/api/messages/${messageId}/media`, {
    credentials: "include",
  });

  if (!res.ok) return null;

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  mediaCache.set(messageId, blobUrl);
  return blobUrl;
}
```

---

### Rendering messages

```js
async function renderMessage(message) {
  const isAgentMedia = message.senderType === "AGENT" && message.messageType !== "TEXT";
  const isCustomerMedia = message.senderType === "CUSTOMER" && message.messageType !== "TEXT";

  // For agent-sent media: content field holds the Cloudinary URL directly
  // For customer-sent media: must fetch through the proxy with auth
  let mediaSrc = null;

  if (isAgentMedia) {
    mediaSrc = message.content; // Cloudinary URL — use directly
  } else if (isCustomerMedia) {
    mediaSrc = await getAuthenticatedMediaUrl(message.id); // proxied through backend
  }

  switch (message.messageType) {
    case "TEXT":
      return `<div class="message-text">${message.content}</div>`;

    case "IMAGE":
      return `<img
        src="${mediaSrc}"
        class="message-image"
        style="max-width: 300px; border-radius: 8px; display: block;"
        loading="lazy"
      />`;

    case "VIDEO":
      return `<video
        controls
        src="${mediaSrc}"
        style="max-width: 300px; border-radius: 8px;"
      ></video>`;

    case "AUDIO":
      return `<audio controls src="${mediaSrc}"></audio>`;

    case "DOCUMENT":
      return `<a href="${mediaSrc}" target="_blank" download>
        📄 Download document
      </a>`;

    default:
      return `<div class="message-text">${message.content}</div>`;
  }
}
```

---

### React component example

```jsx
import { useState, useEffect } from "react";

function MediaMessage({ message }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (message.messageType === "TEXT") return;

    if (message.senderType === "AGENT") {
      // Agent messages use the Cloudinary URL stored in content
      setSrc(message.content);
    } else {
      // Customer messages must be proxied through backend
      fetch(`http://localhost:8000/api/messages/${message.id}/media`, {
        credentials: "include",
      })
        .then((r) => r.blob())
        .then((blob) => setSrc(URL.createObjectURL(blob)))
        .catch(() => setSrc(null));
    }
  }, [message.id]);

  if (message.messageType === "TEXT") {
    return <p>{message.content}</p>;
  }

  if (!src) return <span style={{ opacity: 0.5 }}>Loading...</span>;

  if (message.messageType === "IMAGE")
    return <img src={src} style={{ maxWidth: 300, borderRadius: 8 }} />;

  if (message.messageType === "VIDEO")
    return <video controls src={src} style={{ maxWidth: 300, borderRadius: 8 }} />;

  if (message.messageType === "AUDIO")
    return <audio controls src={src} />;

  if (message.messageType === "DOCUMENT")
    return <a href={src} target="_blank" rel="noreferrer">📄 Download document</a>;
}
```

---

## Part 3 — Socket.IO (Real-time)

When any message (text or media) is created, the server emits:

```js
socket.on("message.created", ({ message, conversationId }) => {
  // message.messageType tells you what to render
  // message.senderType tells you if it's from AGENT or CUSTOMER
  // For CUSTOMER media: call getAuthenticatedMediaUrl(message.id)
  // For AGENT media: use message.content directly as src
});
```

---

## Summary

| Scenario | How to get the media URL |
|---|---|
| Agent sends image/video/audio/doc | Upload to `/api/media/upload` → get Cloudinary URL → pass to `/api/messages/send` |
| Agent's sent message displayed | Use `message.content` directly as `src` (it's the Cloudinary URL) |
| Customer sends image/video/audio/doc | Fetch `/api/messages/:id/media` with `credentials: "include"` → create blob URL |

---

## Errors

| Status | Meaning |
|---|---|
| 400 | No file provided, or unsupported file type |
| 401 | Not logged in |
| 413 | File too large (over 16MB) |
| 502 | Meta or Cloudinary API error (usually expired WhatsApp token) |
