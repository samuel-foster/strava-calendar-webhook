# Strava to Google Calendar Sync

Automatically sync Strava activities to your Google Calendar using webhooks, with a 30-minute polling fallback. Replaces Google Apps Script time-based triggers with real-time event processing.

## Features

- **Real-time webhook sync**: Activities sync immediately when created (via Strava webhooks)
- **Polling fallback**: 30-minute scheduled polling as a safety net for missed webhooks
- **Discord alerts**: Success/error notifications sent to Discord channel
- **Audit logging**: SQLite database logs all sync attempts with timestamps and status
- **Duplicate detection**: Prevents duplicate calendar events for the same activity
- **Service account auth**: Uses Google service account (no manual login required)
- **Public webhook exposure**: Tailscale Funnel provides HTTPS endpoint without port forwarding
- **Secure endpoints**: Manual sync trigger protected with authentication token

## Prerequisites

- **Node.js 20+** (for local development) or **Docker & Docker Compose** (for production)
- **Tailscale** (free account for secure networking)
- **Google Cloud Project** with Calendar API enabled and service account
- **Strava API credentials** (client ID, secret, and refresh token from OAuth flow)
- **Discord server & channel** for webhook alerts
- **Linux machine** or any system that can run Docker containers (deployment target)
- **SQLite3** (for local database inspection); included in container

## Setup

### 1. Clone Repository

```bash
git clone https://github.com/samuel-foster/strava-calendar-webhook.git
cd strava-calendar-webhook
```

### 2. Get Strava Credentials

1. Go to [Strava API Settings](https://www.strava.com/settings/api)
2. Copy `Client ID` and `Client Secret`
3. Generate a refresh token:
   - Go to [Strava OAuth Tool](https://developers.strava.com/docs/authentication/)
   - Complete OAuth flow to get a refresh token
   - Save the token securely

Store these:
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_REFRESH_TOKEN`

### 3. Create Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or use existing one
3. Enable **Google Calendar API** (Search → APIs & Services → Calendar API → Enable)
4. Create a service account:
   - APIs & Services → Credentials → Create Credentials → Service Account
   - Grant "Editor" or custom role with calendar.events.create, calendar.events.list permissions
5. Create a key (JSON format) and download it
6. Extract from JSON:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY`
   - `project_id` → `GOOGLE_PROJECT_ID`
7. Share your Google Calendar with the service account email (add as editor)
8. Get your calendar ID from Google Calendar → Settings → Calendar ID

Store these:
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_PROJECT_ID`
- `GOOGLE_CALENDAR_ID`

### 4. Create Discord Webhook

1. In your Discord server, create a new channel (e.g., `#strava-sync`)
2. Right-click channel → Edit Channel → Integrations → Webhooks → New Webhook
3. Copy the webhook URL

Store this:
- `DISCORD_WEBHOOK_URL`

### 5. Set Up Tailscale (on deployment target)

On the Linux machine where you'll run the container:

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Enable Tailscale Funnel for public HTTPS access:
```bash
sudo tailscale funnel on
```

Get your public Tailscale URL (will be something like `https://your-hostname.tail9ea521.ts.net`):
```bash
tailscale funnel status
```

### 6. Create `.env` File (on deployment target)

On your Linux machine, in the repo directory:

```bash
cp .env.example .env
nano .env  # Edit with your values
```

Fill in all credentials from steps 2-4, plus:
- `PORT=3000` (internal container port)
- `NODE_ENV=production`
- `STRAVA_WEBHOOK_VERIFICATION_TOKEN` (any random string for webhook signing)
- `SYNC_SECRET_TOKEN` (random token for manual `/sync` endpoint authentication)

Generate tokens:
```bash
openssl rand -hex 32  # Run twice for two tokens
```

### 7. Deploy with Docker

```bash
# On your Linux machine:
docker compose up -d
```

Verify it's running:
```bash
docker logs -f strava-gcal-sync
```

You should see:
```
Server running on port 3000
Webhook endpoint: GET /webhook?hub.mode=...
Polling scheduler started (30-minute intervals)
```

### 8. Register Webhook with Strava

Once the app is running and accessible via Tailscale Funnel:

```bash
# Replace with your actual Tailscale URL
TAILSCALE_URL="https://your-hostname.tail9ea521.ts.net"
CLIENT_ID="your-client-id"
CLIENT_SECRET="your-client-secret"
VERIFY_TOKEN="your-webhook-verification-token"

curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id="$CLIENT_ID" \
  -F client_secret="$CLIENT_SECRET" \
  -F callback_url="$TAILSCALE_URL/webhook" \
  -F verify_token="$VERIFY_TOKEN"
```

Strava will send a GET request to verify the callback — your app automatically responds with the challenge token.

On success, you'll receive a subscription ID (save this for reference).

### 9. Verify Setup

Test the webhook endpoint:
```bash
curl "https://your-tailscale-url/webhook?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=YOUR_VERIFY_TOKEN"
```

Should return: `{"hub.challenge":"test123"}`

Test manual sync (requires SYNC_SECRET_TOKEN):
```bash
curl -X POST https://your-tailscale-url/sync \
  -H "x-sync-token: YOUR_SYNC_SECRET_TOKEN"
```

Check health:
```bash
curl https://your-tailscale-url/health
```

Should return: `{"status":"ok"}`

## API Endpoints

### Health Check
```
GET /health
```
Returns `{"status":"ok"}` if the app is running.

### Webhook (GET - Verification)
```
GET /webhook?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token=YOUR_TOKEN
```
Called by Strava to verify the webhook. Automatically responds with the challenge token.

### Webhook (POST - Events)
```
POST /webhook
X-Strava-Signature: <HMAC-SHA256 signature>
```
Receives real-time activity events from Strava. Signature must be valid (computed using `STRAVA_WEBHOOK_VERIFICATION_TOKEN`).

### Manual Sync Trigger
```
POST /sync
X-Sync-Token: YOUR_SYNC_SECRET_TOKEN
```
Manually triggers a sync cycle (useful for testing or forced updates). Requires authentication token.

## Architecture

**How It Works:**

1. **Webhook Flow** (Real-time):
   - User creates/updates activity in Strava
   - Strava sends POST to `/webhook` with HMAC-SHA256 signature
   - App validates signature
   - Fetches activity details from Strava API
   - Searches Google Calendar for existing event (by Strava activity ID)
   - Creates calendar event if new, skips if duplicate
   - Logs result to SQLite and sends Discord alert

2. **Polling Flow** (Fallback):
   - Every 30 minutes, node-cron fires `pollAndSync()`
   - Fetches recent activities from Strava API
   - Compares against `last_activity_id` in SQLite
   - Processes only new activities (prevents re-processing)
   - Same duplicate detection & alert flow as webhook

3. **Database Schema**:
   - `state` table: Tracks `last_activity_id` and sync metadata
   - `sync_log` table: Audit trail (timestamp, activity_id, status, error_message, sync_source)

**File Structure:**

```
src/
├── index.js                  # Express server + endpoint definitions
├── webhookHandler.js         # Webhook verification & event processing
├── pollingScheduler.js       # 30-min polling + scheduling
├── stravaApi.js              # Strava API client (OAuth token refresh, activity fetch)
├── calendarApi.js            # Google Calendar API client (event search, create, format)
├── database.js               # SQLite initialization + state/logging
└── discord.js                # Discord embed formatting & webhook alerts

data/
└── sync.db                   # SQLite database (persisted Docker volume)

docker-compose.yml            # Service definition + environment + volumes
Dockerfile                    # Node.js 20-Alpine + build steps
.env.example                  # Template for environment variables
package.json                  # Dependencies: express, axios, googleapis, sqlite3, node-cron, dotenv
```

**Technology Stack:**
- **Runtime**: Node.js 20 on Alpine Linux
- **Web Framework**: Express.js
- **Database**: SQLite3 (lightweight, no server required)
- **Scheduling**: node-cron (Unix cron syntax)
- **APIs**: axios for HTTP, googleapis SDK for Google Calendar
- **Security**: crypto (HMAC-SHA256 signature validation)
- **Container**: Docker + Docker Compose for reproducible deployment

## Monitoring & Debugging

### View Container Logs

```bash
# Real-time logs
docker logs -f strava-gcal-sync

# Last 50 lines
docker logs --tail 50 strava-gcal-sync

# With timestamps
docker logs -f --timestamps strava-gcal-sync
```

### Check SQLite Database

```bash
# Sync audit log (most recent first)
sqlite3 data/sync.db "SELECT timestamp, activity_id, activity_name, sync_source, status, error_message FROM sync_log ORDER BY timestamp DESC LIMIT 20;"

# Current state
sqlite3 data/sync.db "SELECT * FROM state;"

# Stats by sync source
sqlite3 data/sync.db "SELECT sync_source, COUNT(*) as count, status FROM sync_log GROUP BY sync_source, status ORDER BY timestamp DESC;"

# Find errors
sqlite3 data/sync.db "SELECT timestamp, activity_id, error_message FROM sync_log WHERE status = 'error' ORDER BY timestamp DESC LIMIT 10;"
```

### Test Endpoints

```bash
# Health check
curl https://your-tailscale-url/health

# Test webhook verification (won't actually verify, just tests the logic)
curl "https://your-tailscale-url/webhook?hub.mode=subscribe&hub.challenge=test&hub.verify_token=YOUR_VERIFY_TOKEN"

# Manual sync (requires SYNC_SECRET_TOKEN)
curl -X POST https://your-tailscale-url/sync \
  -H "x-sync-token: YOUR_SYNC_SECRET_TOKEN"
```

### Check Strava Webhook Subscription

```bash
# List active subscriptions
curl -G https://www.strava.com/api/v3/push_subscriptions \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET
```

### Verify Tailscale Funnel

```bash
# Check status
tailscale funnel status

# View logs
sudo journalctl -u tailscaled -f
```

## Troubleshooting

### Webhook Not Receiving Events

**Symptoms**: Strava activities aren't syncing immediately, only on polling cycle

**Check list**:
1. Verify webhook is registered:
   ```bash
   curl -G https://www.strava.com/api/v3/push_subscriptions \
     -d client_id=YOUR_CLIENT_ID \
     -d client_secret=YOUR_CLIENT_SECRET
   ```
   - Should show your subscription with `callback_url` matching your Tailscale Funnel URL
   
2. Verify Tailscale Funnel is active:
   ```bash
   tailscale funnel status
   ```
   - Should show "enabled" and your public HTTPS URL

3. Test webhook verification manually:
   ```bash
   curl "https://your-url/webhook?hub.mode=subscribe&hub.challenge=abc&hub.verify_token=YOUR_TOKEN"
   ```
   - Should return `{"hub.challenge":"abc"}`

4. Check container is running:
   ```bash
   docker ps | grep strava-gcal-sync
   ```

5. Review logs for errors:
   ```bash
   docker logs strava-gcal-sync | grep -i webhook
   ```

### Port Conflicts

**Error**: `Address already in use` or port 3000 taken

**Solution**:
1. Check what's using the port:
   ```bash
   sudo lsof -i :3000
   ```
   
2. Change port in `docker-compose.yml`:
   ```yaml
   ports:
     - "3002:3000"  # Change external port if needed
   ```

3. Rebuild and restart:
   ```bash
   docker compose down
   docker compose build --no-cache
   docker compose up -d
   ```

### Activities Not Syncing to Calendar

**Symptoms**: Webhook is verified, but events not appearing in Google Calendar

**Check list**:
1. Verify Google Calendar API is enabled:
   - [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Calendar API → Status

2. Verify service account has access to calendar:
   ```bash
   google-calendar-email@project.iam.gserviceaccount.com
   ```
   - Should be shared as **Editor** on your Google Calendar

3. Verify credentials in `.env`:
   ```bash
   grep GOOGLE_ .env
   ```
   - Should show email, project_id, and private_key (starts with `-----BEGIN PRIVATE KEY-----`)

4. Check logs for Google API errors:
   ```bash
   docker logs strava-gcal-sync | grep -i google
   ```

5. Check sync_log for error details:
   ```bash
   sqlite3 data/sync.db "SELECT activity_id, error_message FROM sync_log WHERE status = 'error';"
   ```

### Duplicate Events in Calendar

**Issue**: Same activity created multiple times in calendar

**This shouldn't happen** — the app searches for existing events by Strava ID before creating new ones.

**If it occurs**:
1. Manually delete duplicates from calendar
2. Check SQLite log for what's being synced:
   ```bash
   sqlite3 data/sync.db "SELECT activity_id, activity_name, COUNT(*) as count FROM sync_log GROUP BY activity_id, activity_name HAVING count > 1;"
   ```
3. Report the activity_id — may indicate a bug in duplicate detection

### Polling Not Running

**Symptoms**: 30-minute polling never executes, only webhook syncs

**Check list**:
1. Verify cron expression in logs:
   ```bash
   docker logs strava-gcal-sync | grep -i polling
   ```
   - Should show `Polling scheduler started`

2. Check Docker container is not restarting:
   ```bash
   docker ps strava-gcal-sync
   ```
   - If `RESTART` column shows "0s ago" or high restart count, container is crashing

3. Wait 30 minutes and check logs for `[POLLING]`:
   ```bash
   docker logs --since 30m strava-gcal-sync | grep POLLING
   ```

4. Manual sync test (doesn't wait for cron):
   ```bash
   curl -X POST https://your-tailscale-url/sync \
     -H "x-sync-token: YOUR_TOKEN"
   ```

### Strava API 401 Unauthorized

**Error**: `401 Unauthorized` in logs when fetching activities

**Cause**: Refresh token expired or invalid

**Solution**:
1. Get a new refresh token from [Strava OAuth](https://developers.strava.com/docs/authentication/)
2. Update `.env`:
   ```bash
   STRAVA_REFRESH_TOKEN=new-token
   ```
3. Restart container:
   ```bash
   docker compose restart strava-sync
   ```

### Discord Alerts Not Sending

**Symptoms**: Syncs happening but no Discord notifications

**Check list**:
1. Verify Discord webhook URL in `.env`:
   ```bash
   grep DISCORD_WEBHOOK .env
   ```
   - Should start with `https://discord.com/api/webhooks/...`

2. Test webhook manually:
   ```bash
   curl -X POST "YOUR_DISCORD_WEBHOOK_URL" \
     -H "Content-Type: application/json" \
     -d '{"content":"Test message"}'
   ```

3. Check logs for Discord errors:
   ```bash
   docker logs strava-gcal-sync | grep -i discord
   ```

4. Verify webhook still exists in Discord:
   - Go to channel → Integrations → Webhooks → Should still be listed

### Container Won't Start

**Error**: `docker compose up` fails immediately

**Check list**:
1. Verify `.env` exists and is readable:
   ```bash
   ls -la .env
   ```

2. Check for syntax errors in `.env`:
   ```bash
   cat .env | grep -E '=\s*$'  # Find empty values
   ```

3. Check Docker logs:
   ```bash
   docker logs strava-gcal-sync
   ```

4. Rebuild from scratch:
   ```bash
   docker compose down
   docker compose build --no-cache
   docker compose up
   ```

### Rate Limiting from Strava

**Error**: `429 Too Many Requests` from Strava API

**Cause**: Strava API rate limits (100 requests per 15 minutes per app)

**Solution**:
- Reduce polling frequency (edit `pollingScheduler.js` cron expression)
- Or wait 15 minutes before retrying
- Monitor API call logs to optimize

### General Debugging

**Enable verbose logging** (edit `src/index.js`):
```javascript
console.log(`[DEBUG] Received webhook for activity ID: ${activityId}`);
```

Then rebuild:
```bash
   docker compose build --no-cache
   docker compose up -d

**Database corruption**:
If SQLite seems locked or corrupted:
```bash
# Backup old database
cp data/sync.db data/sync.db.backup

# Delete (will be recreated on next start)
rm data/sync.db

# Restart
docker compose restart strava-sync
```

## Environment Variables

Create a `.env` file with the following variables:

```bash
# Strava API
STRAVA_CLIENT_ID=your-client-id
STRAVA_CLIENT_SECRET=your-client-secret-key
STRAVA_REFRESH_TOKEN=your-refresh-token
STRAVA_WEBHOOK_VERIFICATION_TOKEN=random-string-for-signature-validation

# Google Calendar
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...private key content...\n-----END PRIVATE KEY-----"
GOOGLE_PROJECT_ID=your-gcp-project-id
GOOGLE_CALENDAR_ID=your-calendar@gmail.com

# Discord
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxx/yyy

# Server
PORT=3000
NODE_ENV=production
SYNC_SECRET_TOKEN=random-token-for-manual-sync-auth
```

**Note**: The `GOOGLE_PRIVATE_KEY` should include literal `\n` characters (not actual newlines). The JSON parsing handles this automatically.

## Security Considerations

- **Never commit `.env`** to Git — use `.env.example` as template only
- **Webhook signature validation**: All POST requests to `/webhook` are validated with HMAC-SHA256
- **Sync token authentication**: Manual `/sync` endpoint requires `x-sync-token` header matching `SYNC_SECRET_TOKEN`
- **Tailscale Funnel**: Provides HTTPS encryption and Tailscale's network authentication
- **Service account auth**: No user login required; service account email must be shared as calendar editor
- **Payload size limit**: Maximum 10KB payload (prevents large attack requests)

## Development (Local)

To run locally without Docker:

```bash
npm install
npm start
```

The server will run on `http://localhost:3000`. You'll need:
- All `.env` variables set
- Node.js 20+
- SQLite3 available locally

## Disabling Google Apps Script (Cleanup)

Once this app is running reliably:

1. Open your Google Apps Script project
2. Click the **trigger icon** (⏰) in the left sidebar
3. For each trigger, click the **three dots** → **Delete trigger**
4. Delete or archive the Apps Script project (if no longer needed)

No need to keep time-based triggers running anymore!

## Contributing

Found a bug or want to improve? 

1. Create an issue describing the problem
2. Fork the repo
3. Make changes on a feature branch
4. Test thoroughly
5. Submit a pull request

## License

MIT
