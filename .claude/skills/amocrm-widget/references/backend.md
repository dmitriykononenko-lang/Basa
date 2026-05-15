# Backend reference — OAuth, REST API, webhooks, DP/Salesbot payloads

Most non-trivial widgets have a backend the widget JS talks to (your service, not amoCRM's). It typically does three things: hold OAuth tokens, call amoCRM's REST API on the user's behalf, and receive webhooks (Digital Pipeline, Salesbot, public webhooks). This doc covers all three.

The amoCRM and Kommo APIs are the same — different domains. Russian accounts: `https://<subdomain>.amocrm.ru`. International: `https://<subdomain>.kommo.com`. Endpoints and payloads are identical.

## 1. OAuth 2.0 flow

### Setup in the developer cabinet

1. Create an integration with `oauth: "Y"` in the manifest.
2. In the cabinet's *Integration → Settings* tab, set the **Redirect URI** to your backend's callback URL (must be HTTPS, must match exactly — port and trailing slash included).
3. Copy the **integration ID** (also called `client_id` / `client_uuid`) and **secret key**. These go to your backend's config, not the manifest.

### Authorization Code grant

When a user clicks "Install" on your marketplace listing (or you trigger the connect flow from a widget UI), the browser is redirected to:

```
https://www.amocrm.ru/oauth?client_id=<client_uuid>&state=<your_csrf>&mode=post_message
```

After the user approves, amoCRM redirects back to your registered redirect URI with a `code` query parameter (valid for 20 minutes, single-use):

```
GET https://your-backend/oauth/callback?code=def50200...&state=<your_csrf>&referer=<subdomain>.amocrm.ru
```

Your backend must validate `state` (CSRF) and then exchange the code for tokens:

```http
POST https://<subdomain>.amocrm.ru/oauth2/access_token
Content-Type: application/json

{
  "client_id":     "<client_uuid>",
  "client_secret": "<secret_key>",
  "grant_type":    "authorization_code",
  "code":          "<code from callback>",
  "redirect_uri":  "https://your-backend/oauth/callback"
}
```

Response:

```json
{
  "token_type":    "Bearer",
  "expires_in":    86400,
  "access_token":  "eyJ0eXAiOiJKV1Qi...",
  "refresh_token": "def50200..."
}
```

Store both tokens encrypted, keyed by `account_id` (from `JWT.decode(access_token).account_id` or from your own user lookup). The access token expires in 24 hours. The refresh token is valid for **3 months** — if you go 3 months without refreshing, the user has to re-authorize.

### Refresh flow

Refresh before each call, or proactively when the access token has < 5 minutes left:

```http
POST https://<subdomain>.amocrm.ru/oauth2/access_token
Content-Type: application/json

{
  "client_id":     "<client_uuid>",
  "client_secret": "<secret_key>",
  "grant_type":    "refresh_token",
  "refresh_token": "<stored refresh_token>",
  "redirect_uri":  "https://your-backend/oauth/callback"
}
```

The response gives you a new access_token AND a new refresh_token. **Rotate both — old refresh_token is invalidated.** A common bug: storing only the new access_token and reusing the old refresh_token. Two refreshes later, you're locked out.

### JWT claims

The access token is a JWT. Decode (don't verify — amoCRM doesn't publish a JWKS; trust the source) to get useful fields:

```json
{
  "iss": "https://amocrm.ru",
  "aud": "<client_uuid>",
  "jti": "<token id>",
  "iat": 1715000000,
  "nbf": 1715000000,
  "exp": 1715086400,
  "account_id": 12345,
  "sub":        "<user_email_or_uuid>",
  "client_uuid": "<client_uuid>",
  "scopes":      ["crm","notifications","push_notifications"]
}
```

Use `account_id` to look up your stored creds; use `scopes` to gate features.

## 2. REST API basics

Base URL is the account subdomain: `https://<subdomain>.amocrm.ru/api/v4/...` (or `.kommo.com`).

Auth via `Authorization: Bearer <access_token>`. JSON in, JSON out.

Common endpoints:

- `GET  /api/v4/leads` — list leads (filter, paginate, embed contacts/companies).
- `GET  /api/v4/leads/{id}` — one lead.
- `POST /api/v4/leads` — create one or many (array body).
- `PATCH /api/v4/leads/{id}` — update.
- `POST /api/v4/leads/{id}/_embedded/tags` — attach tags.
- `GET  /api/v4/contacts/{id}` and `/api/v4/companies/{id}` — analogous.
- `GET  /api/v4/account` — current account info, custom_fields, pipelines.
- `POST /api/v4/leads/{id}/notes` — add a note (text, call, mail, attachment).

Pagination is via `page` and `limit` (max 250). The response embeds links to next/prev pages — follow them via `_links.next.href`.

### Custom fields

Every entity has `custom_fields_values` — array of `{ field_id, field_name, field_code, field_type, values: [{ value, enum_id, enum_code }] }`. To write a custom field, send the same shape in `PATCH`:

```json
{
  "custom_fields_values": [
    { "field_id": 12345, "values": [{ "value": "+79991234567", "enum_code": "MOBILE" }] }
  ]
}
```

Get the field ids from `GET /api/v4/leads/custom_fields` (and `/contacts/custom_fields`, `/companies/custom_fields`).

### Rate limits

Around 7 requests/second per account by default. The 429 response includes `Retry-After`. Burst patterns: chunk batch operations into arrays of up to 250 entities per request rather than firing N parallel single requests.

## 3. Webhook signature verification

amoCRM webhooks (DP, Salesbot, public hooks via `/api/v4/webhooks`) are POSTed to your endpoint as `application/x-www-form-urlencoded` (DP/Salesbot — historically) or JSON (modern public hooks). Signature verification:

1. **The hook comes with `signature` (GET param) and `client_uuid` (GET param).** Verify both — `client_uuid` should match your integration; `signature` is `md5(secret_key + body)` for legacy hooks, or `sha1(secret_key + body)` for newer ones (check the integration's settings page in the cabinet for which scheme is active).
2. **Reject hooks with mismatched signature** before parsing. Constant-time comparison (don't use `==` on strings).

```python
import hashlib, hmac
def verify_hook(body_bytes, signature_param, secret):
    expected = hashlib.sha1((secret + body_bytes.decode()).encode()).hexdigest()
    return hmac.compare_digest(expected, signature_param)
```

Respond `200 OK` quickly (within 2 seconds). Heavy processing should be queued — amoCRM retries on timeout / 5xx, and dupe-handling is your job. Use the hook's `id` (or `lead_id + status_id + timestamp` for DP) as an idempotency key.

## 4. Digital Pipeline webhook payload

When a lead enters a stage that triggers your widget, amoCRM POSTs to the URL you registered in the cabinet's *Integration → Hooks* tab. Body is form-urlencoded:

```
account[id]=12345
account[subdomain]=mycompany
leads[status][0][id]=999
leads[status][0][status_id]=142
leads[status][0][pipeline_id]=10
leads[status][0][old_status_id]=141
leads[status][0][old_pipeline_id]=10
leads[status][0][responsible_user_id]=77
leads[status][0][custom_fields][0][id]=12345
leads[status][0][custom_fields][0][values][0][value]=foo
params[template_id]=welcome     # from dp.settings + dpSettings modal
params[send_to]=responsible
```

The `params[...]` keys are the per-step config you defined in `manifest.dp.settings` and (optionally) extended via the `dpSettings` callback. Note these are *per pipeline step* — different steps using the same widget action have independent params.

Your response can include a `result` field which amoCRM displays in the pipeline UI as the action's status:

```json
{ "result": "ok", "message": "Sent at 14:32" }
```

A non-2xx response shows the step as failed. amoCRM retries 3 times with exponential backoff.

## 5. Salesbot designer webhook payload

For widgets registered via `salesbot_designer` in the manifest:

```http
POST https://your-backend/salesbot/handler
Content-Type: application/json

{
  "account_id":  12345,
  "subdomain":   "mycompany",
  "handler_code": "my_widget_send_message",
  "params": { "text": "Hello %name%", "delay": "0" },
  "lead": {
    "id": 999,
    "status_id": 142,
    "pipeline_id": 10
  },
  "conversation": {
    "id": "abc-uuid",
    "client_id": "external_user_42"
  }
}
```

Your response controls what the bot does next:

```json
{
  "status": "ok",
  "next":   "continue",         // "continue" | "stop" | "branch"
  "branch": "negative_path"     // when next: "branch"
}
```

## 6. Public REST API webhooks

Subscribe via `POST /api/v4/webhooks` with `{ destination, settings: ["add_lead","update_lead",...] }`. The webhook payload format is documented per event type. They use the modern signature scheme (sha1 with secret as HMAC key).

These are distinct from DP hooks — DP runs in pipeline automation, public hooks fire on raw entity events regardless of pipeline state. Use public hooks for sync-style integrations (e.g., mirror leads to another CRM); use DP for action-style (send something when stage = X).

## 7. Backend security checklist

- **Tokens encrypted at rest.** AES-GCM with a KMS-managed key, not just env-var encryption.
- **Per-account isolation.** Don't share access_tokens across accounts; each account has its own pair.
- **Signature on every webhook.** No exceptions. Skipped signature checks = the marketplace will reject the integration on review.
- **HTTPS only.** Reject HTTP on redirect URI, hook URL, JS API base URL.
- **State CSRF on OAuth callback.** Verify the `state` you put into the auth URL.
- **Rate limiting on your endpoints.** Especially the OAuth callback — amoCRM can be replayed by malicious actors.
- **Audit logging.** Every token use, every webhook receipt, every API call. Reviewers ask about this for public-marketplace widgets.

## 8. Common backend pitfalls

- **Forgetting to rotate refresh tokens.** Lockout after two refresh cycles.
- **Using the wrong subdomain.** Account 12345 might live at `xyz.amocrm.ru` or `xyz.kommo.com` — the JWT's `iss` claim tells you. Don't hardcode.
- **Not handling the 24-hour token expiry mid-batch.** If a long batch import outlasts the token, refresh transparently and resume — don't restart from zero.
- **Treating webhook retries as new events.** Use idempotency keys.
- **Calling `/api/v4/leads/{id}/_embedded/contacts/{id}/customers/{id}/...`** nested patterns don't exist — fetch separately and join in your code.
- **Trusting the `referer` in OAuth callback.** It's user-controlled. Always re-derive subdomain from the JWT after token exchange.
