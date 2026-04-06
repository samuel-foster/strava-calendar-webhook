const axios = require('axios');

const STRAVA_API = 'https://www.strava.com/api/v3';
let accessToken = null;
let tokenExpiry = null;

async function refreshAccessToken() {
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  try {
    const response = await axios.post(`${STRAVA_API}/oauth/token`, {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: process.env.STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    });

    accessToken = response.data.access_token;
    tokenExpiry = Date.now() + response.data.expires_in * 1000;
    console.log('Strava access token refreshed');
    return accessToken;
  } catch (error) {
    console.error('Failed to refresh Strava token:', error.message);
    throw error;
  }
}

async function getActivity(activityId) {
  const token = await refreshAccessToken();
  try {
    const response = await axios.get(`${STRAVA_API}/activities/${activityId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  } catch (error) {
    console.error(`Failed to fetch activity ${activityId}:`, error.message);
    throw error;
  }
}

async function getAthleteActivities(before = null) {
  const token = await refreshAccessToken();
  try {
    const params = {
      per_page: 30,
      page: 1,
    };
    if (before) params.before = Math.floor(before / 1000); // Strava uses Unix timestamp in seconds

    const response = await axios.get(`${STRAVA_API}/athlete/activities`, {
      headers: { Authorization: `Bearer ${token}` },
      params,
    });
    return response.data;
  } catch (error) {
    console.error('Failed to fetch athlete activities:', error.message);
    throw error;
  }
}

module.exports = {
  refreshAccessToken,
  getActivity,
  getAthleteActivities,
};
