const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

let calendar = null;

function initCalendarApi() {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const projectId = process.env.GOOGLE_PROJECT_ID;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      project_id: projectId,
      private_key: privateKey,
      client_email: serviceAccountEmail,
      client_id: '1',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${serviceAccountEmail}`,
    },
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  calendar = google.calendar({ version: 'v3', auth });
  console.log('Google Calendar API initialized');
}

async function searchEventByStravaId(stravaActivityId) {
  if (!calendar) initCalendarApi();

  try {
    const response = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      q: `strava:${stravaActivityId}`,
      maxResults: 1,
    });

    return response.data.items && response.data.items.length > 0 ? response.data.items[0] : null;
  } catch (error) {
    console.error('Failed to search event by Strava ID:', error.message);
    throw error;
  }
}

async function createCalendarEvent(activity) {
  if (!calendar) initCalendarApi();

  try {
    // Check if event already exists
    const existingEvent = await searchEventByStravaId(activity.id);
    if (existingEvent) {
      console.log(`Event already exists for activity ${activity.id}, skipping creation`);
      return existingEvent.id;
    }

    // Format event details
    const event = formatActivityAsEvent(activity);

    const response = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      resource: event,
    });

    console.log(`Created calendar event for activity ${activity.id}: ${response.data.id}`);
    return response.data.id;
  } catch (error) {
    console.error('Failed to create calendar event:', error.message);
    throw error;
  }
}

function formatActivityAsEvent(activity) {
  const startTime = new Date(activity.start_date);
  const durationMinutes = Math.round(activity.elapsed_time / 60);
  const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

  // Use activity name as-is for the event title
  let title = activity.name || activity.type;

  // Build event description with details
  let description = `Strava Activity: strava:${activity.id}\n`;
  if (activity.distance) description += `Distance: ${(activity.distance / 1000).toFixed(2)} km\n`;
  if (activity.total_elevation_gain) description += `Elevation: ${Math.round(activity.total_elevation_gain)} m\n`;
  if (activity.average_speed) description += `Avg Speed: ${(activity.average_speed * 3.6).toFixed(2)} km/h\n`;
  if (activity.max_speed) description += `Max Speed: ${(activity.max_speed * 3.6).toFixed(2)} km/h\n`;
  if (activity.average_heartrate) description += `Avg HR: ${Math.round(activity.average_heartrate)} bpm\n`;
  if (activity.calories) description += `Calories: ${Math.round(activity.calories)}\n`;

  return {
    summary: title,
    description,
    start: {
      dateTime: startTime.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    transparency: 'transparent', // Don't block calendar
  };
}

async function syncActivityToCalendar(activity) {
  try {
    const eventId = await createCalendarEvent(activity);
    return eventId;
  } catch (error) {
    console.error(`Failed to sync activity ${activity.id} to calendar:`, error.message);
    throw error;
  }
}

module.exports = {
  initCalendarApi,
  searchEventByStravaId,
  createCalendarEvent,
  formatActivityAsEvent,
  syncActivityToCalendar,
};
