# Strava to Google Calendar Sync

Automatically sync Strava activities to your Google Calendar using webhooks, with polling fallback.

## Features

- **Real-time webhook sync**: Activities sync immediately when created in Strava
- **Polling fallback**: 30-minute polling backup for missed webhooks
- **Discord alerts**: Error notifications sent to Discord
- **Audit logging**: SQLite database logs all sync attempts
- **Service account auth**: No manual login required
- **Tailscale integration**: Secure webhook exposure without port forwarding

## Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Tailscale (free account)
- Google Cloud project with Calendar API enabled
- Strava API credentials
- Discord webhook URL

## Setup

### 1. Clone & Install

```bash
git clone <your-repo> Strava-GCal-Sync
cd Strava-GCal-Sync
npm install
```

### 2. Get Strava Credentials

1. Go to [Strava API Settings](https://www.strava.com/settings/api)
2. Copy `Client ID` and `Client Secret`
3. Generate a refresh token (use [Strava OAuth tool](https://developers.strava.com/docs/authentication/) or ask me for guide)

### 3. Create Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or use existing
3. Enable Google Calendar API
4. Create a service account key (JSON)
5. Download the JSON and extract:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY`
   - `project_id` → `GOOGLE_PROJECT_ID`
6. Share your Google Calendar with the service account email
7. Get your calendar ID from Calendar settings → `GOOGLE_CALENDAR_ID`

### 4. Get Discord Webhook

On your Linux machine, grep your media server project:
```bash
grep -r "DISCORD_WEBHOOK" /path/to/media-server/
```

Copy the webhook URL.

### 5. Create `.env` File

```bash
cp .env.example .env
```

Fill in all values from steps 2-4.

### 6. Set Up Tailscale

```bash
# On your Linux machine:
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Get your Tailscale IP:
```bash
tailscale ip -4
```

### 7. Deploy to Docker

```bash
docker-compose up -d
```

### 8. Register Webhook with Strava

Once the app is running and Tailscale is connected:

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -H "Content-Type: application/json" \
  -d {
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET",
    "callback_url": "https://<your-tailscale-ip>/webhook",
    "verify_token": "YOUR_STRAVA_WEBHOOK_VERIFICATION_TOKEN"
  }
```

Strava will verify the callback — your app must respond with the challenge token.

## Architecture

- **src/index.js**: Express server setup
- **src/webhookHandler.js**: Strava webhook endpoint
- **src/pollingScheduler.js**: 30-min polling fallback
- **src/stravaApi.js**: Strava API calls + token refresh
- **src/calendarApi.js**: Google Calendar API calls
- **src/database.js**: SQLite state & audit logging
- **src/discord.js**: Discord alert sending
- **data/sync.db**: SQLite database (persisted in Docker volume)

## Monitoring

Check logs:
```bash
docker logs -f strava-gcal-sync
```

Check SQLite audit log:
```bash
sqlite3 data/sync.db "SELECT * FROM sync_log ORDER BY timestamp DESC LIMIT 10;"
```

Check state:
```bash
sqlite3 data/sync.db "SELECT * FROM state;"
```

## Troubleshooting

### Webhook not verifying
- Check that Tailscale IP is correct and reachable
- Verify `STRAVA_WEBHOOK_VERIFICATION_TOKEN` matches what you registered
- Check Discord alerts for errors

### Activities not syncing
- Check app logs: `docker logs strava-gcal-sync`
- Verify Google Calendar API credentials
- Check SQLite audit log for errors

### Polling not running
- Check that node-cron is scheduled correctly
- Verify Strava refresh token is valid

## License

MIT
