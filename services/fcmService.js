const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccount.json');

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount)
// });
/**
 * Sends a push notification to a specific user via FCM token
 * @param {string} token - The user's FCM device token
 * @param {string} title - Notification title
 * @param {string} body - Notification message body
 * @param {Object} data - Additional data payload
 */
async function sendPushNotification(token, title, body, data = {}) {
  if (!token) {
    return { success: false, error: 'No token provided' };
  }

  const message = {
    notification: {
      title: title,
      body: body,
    },
    data: data,
    token: token,
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('✅ FCM Success:', response);
    return { success: true, response };
  } catch (error) {
    console.error('❌ FCM Error:', error.code || error.message);
    return { success: false, error };
  }
}

module.exports = { sendPushNotification };
