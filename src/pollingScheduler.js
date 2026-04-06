const cron = require('node-cron');
const { getAthleteActivities } = require('./stravaApi');
const { syncActivityToCalendar } = require('./calendarApi');
const { getLastActivityId, updateLastActivityId, logSync } = require('./database');
const { sendSuccessAlert, sendErrorAlert } = require('./discord');

let pollingTask = null;

function startPollingScheduler() {
  // Run every 30 minutes: */30 * * * *
  pollingTask = cron.schedule('*/30 * * * *', async () => {
    console.log('[POLLING] Starting 30-minute polling cycle at', new Date().toISOString());
    await pollAndSync();
  });

  console.log('Polling scheduler started (every 30 minutes)');
}

async function pollAndSync() {
  try {
    const lastActivityId = await getLastActivityId();
    console.log(`[POLLING] Last synced activity ID: ${lastActivityId}`);

    // Fetch recent activities
    const activities = await getAthleteActivities();
    console.log(`[POLLING] Fetched ${activities.length} recent activities`);

    let synced = 0;
    for (const activity of activities) {
      // Only sync if newer than last synced
      if (activity.id > parseInt(lastActivityId)) {
        try {
          console.log(`[POLLING] Syncing activity ${activity.id}: ${activity.name}`);
          const eventId = await syncActivityToCalendar(activity);
          await logSync(activity.id, activity.name, 'success', eventId, null, 'polling');
          await sendSuccessAlert(activity.name, activity.id, eventId);
          await updateLastActivityId(activity.id);
          synced++;
        } catch (error) {
          console.error(`[POLLING] Failed to sync activity ${activity.id}:`, error.message);
          await logSync(activity.id, activity.name, 'error', null, error.message, 'polling');
          await sendErrorAlert(error, activity.id, 'Polling sync failed');
        }
      }
    }

    console.log(`[POLLING] Polling cycle complete: ${synced} activities synced`);
  } catch (error) {
    console.error('[POLLING] Polling error:', error);
    await sendErrorAlert(error, null, 'Polling cycle failed');
  }
}

function stopPollingScheduler() {
  if (pollingTask) {
    pollingTask.stop();
    pollingTask.destroy();
    console.log('Polling scheduler stopped');
  }
}

module.exports = {
  startPollingScheduler,
  stopPollingScheduler,
  pollAndSync,
};
