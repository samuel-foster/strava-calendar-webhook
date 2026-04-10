const { getActivity } = require('./stravaApi');
const { syncActivityToCalendar } = require('./calendarApi');
const { logSync, updateLastActivityId } = require('./database');
const { sendSuccessAlert, sendErrorAlert } = require('./discord');

const WEBHOOK_VERIFICATION_TOKEN = process.env.STRAVA_WEBHOOK_VERIFICATION_TOKEN;

function getWebhookVerificationParams(req) {
  const source = req.query && Object.keys(req.query).length > 0 ? req.query : req.body || {};

  return {
    mode: source['hub.mode'],
    token: source['hub.verify_token'],
    challenge: source['hub.challenge'],
  };
}

// Handle webhook verification from Strava
function handleWebhookVerification(req, res) {
  // Strava sends validation as query parameters: hub.mode, hub.verify_token, hub.challenge
  const { mode, token, challenge } = getWebhookVerificationParams(req);

  console.log('Webhook verification request received:', { mode, token: token ? '***' : 'missing', challenge: challenge ? '***' : 'missing' });

  if (mode !== 'subscribe') {
    console.error('Invalid hub.mode:', mode);
    return res.status(400).json({ error: 'Invalid mode' });
  }

  if (token !== WEBHOOK_VERIFICATION_TOKEN) {
    console.error('Invalid webhook verification token');
    return res.status(403).json({ error: 'Invalid token' });
  }

  if (!challenge) {
    console.error('Missing hub.challenge');
    return res.status(400).json({ error: 'Missing challenge' });
  }

  console.log('✅ Webhook verified successfully - echoing challenge');
  return res.status(200).json({ 'hub.challenge': challenge });
}

// Handle webhook event from Strava
async function handleWebhookEvent(req, res) {
  try {
    const event = req.body;
    console.log('Webhook event received:', event);

    // We only care about activity creation
    if (event.object_type !== 'activity' || event.aspect_type !== 'create') {
      console.log(`Ignoring ${event.object_type}:${event.aspect_type} event`);
      return res.status(200).json({ ok: true });
    }

    const activityId = event.object_id;

    // Fetch full activity details
    const activity = await getActivity(activityId);
    console.log(`Processing activity: ${activity.name} (${activityId})`);

    // Sync to calendar
    const eventId = await syncActivityToCalendar(activity);

    // Log success
    await logSync(activityId, activity.name, 'success', eventId, null, 'webhook');
    
    // Send Discord alert
    await sendSuccessAlert(activity.name, activityId, eventId);

    // Update last activity ID
    await updateLastActivityId(activityId);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);

    // Log failure
    const activityId = req.body.object_id;
    await logSync(activityId, 'Unknown', 'error', null, error.message, 'webhook');

    // Send Discord alert
    await sendErrorAlert(error, activityId, 'Webhook sync failed');

    // Still return 200 to prevent Strava retries
    return res.status(200).json({ ok: false, error: error.message });
  }
}

module.exports = {
  handleWebhookVerification,
  handleWebhookEvent,
};
