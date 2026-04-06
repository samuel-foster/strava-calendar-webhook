const crypto = require('crypto');
const { getActivity } = require('./stravaApi');
const { syncActivityToCalendar } = require('./calendarApi');
const { logSync, updateLastActivityId } = require('./database');
const { sendSuccessAlert, sendErrorAlert } = require('./discord');

const WEBHOOK_VERIFICATION_TOKEN = process.env.STRAVA_WEBHOOK_VERIFICATION_TOKEN;

// Handle webhook verification from Strava
function handleWebhookVerification(req, res) {
  const token = req.body.verify_token;
  const challenge = req.body.challenge;

  if (token !== WEBHOOK_VERIFICATION_TOKEN) {
    console.error('Invalid webhook verification token');
    return res.status(403).json({ error: 'Invalid token' });
  }

  console.log('Webhook verified successfully');
  return res.json({ challenge });
}

// Verify Strava webhook signature
function verifyWebhookSignature(req) {
  const signature = req.headers['x-strava-signature'];
  if (!signature) {
    console.warn('Missing webhook signature');
    return false;
  }

  const payload = JSON.stringify(req.body);
  const hash = crypto
    .createHmac('sha256', process.env.STRAVA_WEBHOOK_VERIFICATION_TOKEN)
    .update(payload)
    .digest('hex');

  const isValid = hash === signature;
  if (!isValid) {
    console.error('Invalid webhook signature');
  }
  return isValid;
}

// Handle webhook event from Strava
async function handleWebhookEvent(req, res) {
  try {
    // Verify signature
    if (!verifyWebhookSignature(req)) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

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
