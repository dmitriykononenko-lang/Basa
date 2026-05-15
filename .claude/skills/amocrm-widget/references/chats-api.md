# Chats API (amojo) reference

The Chats API is a separate backend from the main amoCRM REST API. It lives at `https://amojo.amocrm.ru` (RU) or `https://amojo.kommo.com` (international) and powers Kommo's omnichannel "Chats" — WhatsApp, Telegram, web chat, custom messengers, etc. If you're building a chat-channel integration, this is where you'll spend most of your backend time.

This doc covers: how a channel gets connected, the message envelope shape, signing requests, and webhook handling.

## 1. Channel connection lifecycle

You register a **channel** once globally (across all accounts). Each account that installs your widget then **connects** to that channel and gets a per-account `scope_id`.

### Step 1 — Register the channel (one-time, manual)

In the developer cabinet, on your integration's page, find the *Chats* tab and register a new channel. You'll get:

- `channel_id` — UUID identifying your channel globally.
- `channel_secret` — used as the HMAC key for signing every request you make to amojo.

These go into your backend config, not the manifest.

### Step 2 — Connect a channel for an account (per-install)

When an admin installs your widget on their account, your backend POSTs to amojo to associate the channel with the account:

```http
POST https://amojo.amocrm.ru/v2/origin/custom/<channel_id>/connect
Content-Type: application/json
Date: <RFC 2822 date>
Content-MD5: <md5(body)>
X-Signature: <signature, see below>

{
  "account_id":   "<amojo_id of the account>",
  "title":        "My Messenger",
  "hook_api_version": "v2"
}
```

The `account_id` here is the **amojo_id**, not the regular amoCRM `account_id`. Get it via `GET /api/v4/account?with=amojo_id` (REST API, regular OAuth-bearer auth).

Response:

```json
{
  "account_id": "<amojo_id>",
  "scope_id":   "<channel_id>_<amojo_id>"
}
```

Store `scope_id` — you'll need it on every message you send.

### Step 3 — Disconnect

When the widget is uninstalled, call `DELETE /v2/origin/custom/<channel_id>/disconnect` with the same `account_id` in the body.

## 2. Signing requests

Every request to amojo includes the `X-Signature` header — HMAC-SHA1 of a specific string, with the `channel_secret` as the key.

The string to sign is:

```
<METHOD>\n<MD5_OF_BODY>\n<CONTENT_TYPE>\n<DATE>\n<PATH>
```

Where:

- `METHOD` is uppercase HTTP method (`POST`, `GET`, `DELETE`).
- `MD5_OF_BODY` is the lowercase hex MD5 of the body bytes (same as `Content-MD5` header).
- `CONTENT_TYPE` is the request `Content-Type` (`application/json`).
- `DATE` is the same string as the `Date` header (RFC 2822 format, e.g. `Mon, 12 May 2026 14:00:00 +0000`).
- `PATH` is the path including leading slash, no host (e.g. `/v2/origin/custom/abc-uuid/connect`).

Python reference:

```python
import hashlib, hmac
from email.utils import formatdate

def sign_amojo(method, path, body_bytes, channel_secret, content_type='application/json'):
    date = formatdate(usegmt=True)
    content_md5 = hashlib.md5(body_bytes).hexdigest()
    str_to_sign = "\n".join([method.upper(), content_md5, content_type, date, path])
    signature = hmac.new(channel_secret.encode(), str_to_sign.encode(), hashlib.sha1).hexdigest()
    return {
        "Date": date,
        "Content-Type": content_type,
        "Content-MD5": content_md5,
        "X-Signature": signature
    }
```

A common bug: signing the JSON-encoded body but sending it pretty-printed (different bytes → different MD5 → signature mismatch). Sign and send the exact same bytes.

## 3. Sending a message (outbound — your service → amoCRM)

When your channel receives a message from the user (e.g., a WhatsApp message hit your provider), forward it to amojo:

```http
POST https://amojo.amocrm.ru/v2/origin/custom/<scope_id>
Content-Type: application/json
+ signing headers from above

{
  "event_type": "new_message",
  "payload": {
    "timestamp":    1715000000,
    "msec_timestamp": 1715000000000,
    "msgid":        "external-msg-id-12345",
    "conversation_id": "external-conversation-id-678",
    "sender": {
      "id":   "external-user-id",
      "name": "Иван Петров",
      "phone": "+79991234567",
      "avatar": "https://cdn.example.com/avatars/123.jpg"
    },
    "receiver": {
      "id":   "channel-bot-id",
      "name": "My Bot"
    },
    "message": {
      "type": "text",
      "text": "Привет, мне нужна помощь",
      "media": null,
      "file_name": null,
      "file_size": null
    },
    "silent": false
  }
}
```

amoCRM creates / matches a lead and conversation, persists the message, and the agent sees it in the Chats sidebar in the regular amoCRM UI.

`message.type` values: `text`, `picture`, `video`, `file`, `voice`, `sticker`, `location`, `contact`. For media, include `media` URL (downloadable, ≤ 5 minutes lifetime is fine; amoCRM proxies to its own storage on receipt).

## 4. Receiving an agent reply (inbound — amoCRM → your service)

When an agent types a reply in the Chats sidebar, amoCRM POSTs to your webhook URL (configured in the cabinet's Chats tab):

```http
POST https://your-backend/amojo/webhook
Content-Type: application/json
Date: ...
Content-MD5: ...
X-Signature: ...

{
  "account_id": "<amojo_id>",
  "time":       1715000300,
  "event_type": "new_message",
  "payload": {
    "timestamp": 1715000300,
    "msgid":     "amocrm-msg-id-9999",
    "conversation_id": "external-conversation-id-678",
    "sender": {
      "id":   "agent_77",
      "name": "Agent Anna"
    },
    "message": {
      "type": "text",
      "text": "Здравствуйте! Чем могу помочь?"
    },
    "silent": false
  }
}
```

Verify `X-Signature` using the same scheme as outbound, then deliver the message to your channel (WhatsApp, etc.) and respond `200 OK` with:

```json
{ "new_message": { "msgid": "your-external-msg-id" } }
```

The `msgid` you return is the id amoCRM uses for delivery-receipt callbacks (see `delivery_status` event below).

## 5. Other event types

- **`typing`** — agent or user is typing. Echo to the other side for UX.
- **`delivery_status`** — read/delivered/failed acknowledgment. Update message state in your channel's UI.
- **`reaction`** — emoji reaction added to a message (newer feature, support in Kommo only).

Full list at the `event_type` field is documented in the Chats webhook format reference.

## 6. Importing message history

If users connect a channel that already has history (e.g., a WhatsApp number they've been using), you can backfill via:

```http
POST https://amojo.amocrm.ru/v2/origin/custom/<scope_id>/chats/<conversation_id>/history
```

Same envelope as sending a single message, but `event_type: "history"` and payload is an array of past messages. amoCRM rate-limits this — chunk to ~50 messages per request.

## 7. Idempotency

Both directions need it. Outbound — use your stable `msgid` so retries don't dupe. Inbound — store `payload.msgid` and reject if you've seen it before (amoCRM retries on timeout).

## 8. Common pitfalls

- **`scope_id` shape.** It's `<channel_id>_<amojo_id>`, not just `amojo_id`. Build it correctly from the connect response — don't try to construct it yourself.
- **Forgetting `Date` header.** Without it the signature still computes but won't match amojo's expected value (it derives Date from its own request clock).
- **Signing pretty-JSON.** As noted above — sign the exact bytes you send.
- **Mixing `account_id` (amoCRM) and `amojo_id`.** Different numbers. Always use `amojo_id` against amojo, regular id against `api/v4/*`.
- **Replying to agent message with wrong `msgid`.** The id you return on inbound is the one amoCRM uses for read-receipt callbacks — make it your *external* id (the one your channel actually persisted), not echo back amocrm-msg-id-9999.
- **Channel-vs-lead-source confusion.** A chat channel widget (this doc) is different from a `lead_sources` widget (a generic source registered via `self.add_source()` in JS). Channels go through amojo and handle full chat conversations; lead_sources just attribute new leads. Use channels for real messengers.
- **Webhook signature failures during local dev.** ngrok rewrites the `Date` header in some configs; verify by signing on the original raw bytes before any proxy mangling.

## 9. Testing

amojo has no sandbox. Test against a real test account, on a real channel registration. Cabinet lets you "test connect" which sends a synthetic webhook to your URL — use it to verify signing before going live.

For debugging signature mismatches, log the exact string you signed on both sides — 90% of the time it's a Content-Type with charset, an MD5 in uppercase, or a path with query string included that shouldn't be.
