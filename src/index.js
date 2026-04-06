require('dotenv').config();
const express = require('express');
const { initDatabase, closeDatabase } = require('./database');
const { initCalendarApi } = require('./calendarApi');
const { handleWebhookVerification, handleWebhookEvent } = require('./webhookHandler');
const { startPollingScheduler, stopPollingScheduler } = require('./pollingScheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook endpoint (both GET for verification and POST for events)
app.get('/webhook', (req, res) => {
  console.log('Webhook GET request received');
  handleWebhookVerification({ body: req.query }, res);
});

app.post('/webhook', (req, res) => {
  console.log('Webhook POST request received');
  handleWebhookEvent(req, res);
});

// Start server
async function start() {
  try {
    console.log('Initializing Strava to Google Calendar Sync...');

    // Initialize database
    await initDatabase();

    // Initialize Google Calendar API
    initCalendarApi();

    // Start polling scheduler
    startPollingScheduler();

    // Start Express server
    const server = app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`📅 Webhook endpoint: http://localhost:${PORT}/webhook`);
      console.log(`❤️ Health check: http://localhost:${PORT}/health`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('SIGTERM signal received: closing HTTP server');
      server.close(async () => {
        console.log('HTTP server closed');
        stopPollingScheduler();
        await closeDatabase();
        process.exit(0);
      });
    });

    process.on('SIGINT', async () => {
      console.log('SIGINT signal received: closing HTTP server');
      server.close(async () => {
        console.log('HTTP server closed');
        stopPollingScheduler();
        await closeDatabase();
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
