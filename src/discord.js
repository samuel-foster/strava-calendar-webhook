const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function sendAlert(title, description, status = 'error', activityId = null) {
  if (!DISCORD_WEBHOOK_URL) {
    console.warn('Discord webhook URL not configured');
    return;
  }

  const color = status === 'success' ? 3066993 : status === 'warning' ? 16776960 : 15158332; // green, yellow, red

  const embed = {
    title,
    description,
    color,
    timestamp: new Date().toISOString(),
  };

  if (activityId) {
    embed.fields = [
      {
        name: 'Activity ID',
        value: activityId.toString(),
        inline: true,
      },
    ];
  }

  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      embeds: [embed],
    });
    console.log('Discord alert sent:', title);
  } catch (error) {
    console.error('Failed to send Discord alert:', error.message);
  }
}

async function sendSuccessAlert(activityName, activityId, calendarEventId) {
  await sendAlert(
    '✅ Activity Synced',
    `**${activityName}** has been synced to Google Calendar.\nCalendar Event ID: \`${calendarEventId}\``,
    'success',
    activityId
  );
}

async function sendErrorAlert(error, activityId = null, context = '') {
  const description = context
    ? `**${context}**\n\nError: ${error.message}`
    : `Error: ${error.message}`;

  await sendAlert(
    '❌ Sync Error',
    description,
    'error',
    activityId
  );
}

module.exports = {
  sendAlert,
  sendSuccessAlert,
  sendErrorAlert,
};
