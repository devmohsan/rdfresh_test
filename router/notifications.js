const express = require('express');
const admin = require('firebase-admin');
const authentication = require('../middleware/auth');
const { db } = require('../firebase/db');
const { sendPushNotification } = require('../services/fcmService');

const router = express.Router();

function toMillis(createdAt) {
  if (!createdAt) return 0;
  if (typeof createdAt === 'number') return createdAt;
  if (typeof createdAt === 'string') {
    const ms = Date.parse(createdAt);
    return Number.isNaN(ms) ? 0 : ms;
  }
  // Firestore Timestamp
  if (typeof createdAt.toMillis === 'function') return createdAt.toMillis();
  if (typeof createdAt.toDate === 'function') return createdAt.toDate().getTime();
  return 0;
}

function isUnreadForUser(notification, userId) {
  // Prefer per-user read tracking
  if (Array.isArray(notification.readBy)) return !notification.readBy.includes(userId);
  // Fallback legacy boolean
  if (typeof notification.read === 'boolean') return !notification.read;
  return true;
}

// GET /api/notifications?limit=10
router.get('/', authentication, async (req, res) => {
  try {
    const adminId = req.user?.id || req.user?.email || 'unknown';
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

    // 1. Fetch standard notifications
    const notificationSnapshot = await db
      .collection('notifications')
      .where('notifyTo', '==', adminId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    let notifications = notificationSnapshot.docs.map((doc) => {
      const data = doc.data() || {};
      const unread = isUnreadForUser(data, adminId);
      return {
        id: doc.id,
        title: data.title || data.subject || 'Notification',
        message: data.message || data.body || '',
        createdAt: data.createdAt || null,
        createdAtMs: toMillis(data.createdAt),
        unread,
      };
    });

    // 2. Fetch specific alerts: Orders that are 'delivered' but 'unsigned'
    // We only show these if they match the admin's scope (if needed) 
    // or just show all for the admin panel.
    const unsignedOrdersSnapshot = await db
      .collection('orders')
      .where('status', '==', 'delivered')
      .where('signatureStatus', '==', 'unsigned')
      .limit(5) // Limit alerts to not overflow
      .get();

    const orderAlerts = unsignedOrdersSnapshot.docs.map(doc => {
      const order = doc.data();
      return {
        id: `order-alert-${doc.id}`,
        title: '⚠️ Signature Required',
        message: `Order #${order.orderNumber} delivered but signature is missing.`,
        createdAt: order.lastSyncAt || order.orderDate || new Date().toISOString(),
        createdAtMs: toMillis(order.lastSyncAt || order.orderDate),
        unread: true, // Order alerts are always unread until resolved
        type: 'order_alert',
        orderId: doc.id
      };
    });

    // 3. Combine and Sort
    notifications = [...orderAlerts, ...notifications]
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
      .slice(0, limit);

    const unreadCount = notifications.reduce((sum, n) => sum + (n.unread ? 1 : 0), 0);
    res.json({ unreadCount, notifications });
  } catch (error) {
    console.error('Notifications fetch error:', error);
    res.status(500).json({ unreadCount: 0, notifications: [] });
  }
});

// POST /api/notifications/mark-read (x-www-form-urlencoded: ids=1,2,3)
router.post('/mark-read', authentication, async (req, res) => {
  try {
    const raw = (req.body?.ids || '').toString().trim();
    if (!raw) return res.json({ ok: true });

    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const adminId = req.user?.id || req.user?.email || 'unknown';
    const FieldValue = admin.firestore.FieldValue;

    await Promise.all(
      ids.map((id) =>
        db.collection('notifications').doc(id).set(
          {
            readBy: FieldValue.arrayUnion(adminId),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        )
      )
    );

    res.json({ ok: true });
  } catch (error) {
    console.error('Notifications mark-read error:', error);
    res.status(500).json({ ok: false });
  }
});

// POST /api/notifications/send
router.post('/send', authentication, async (req, res) => {
  try {
    const { title, message, notifyTo } = req.body;
    
    if (!title || !message || !notifyTo) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }

    const docRef = db.collection('notifications').doc();
    const notificationData = {
      id: docRef.id,
      title,
      message,
      notifyTo,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: new Date().toISOString(),
      readBy: [],
      type: 'alert'
    };

    await docRef.set(notificationData);

    // 🔹 New: Send FCM Push Notification
    try {
      // Find user to get their FCM token
      // Assuming notifyTo could be either document ID or email
      let userDoc = await db.collection('users').doc(notifyTo).get();
      
      // If not found by ID, try finding by email
      if (!userDoc.exists) {
        const userSnapshot = await db.collection('users').where('email', '==', notifyTo).limit(1).get();
        if (!userSnapshot.empty) {
          userDoc = userSnapshot.docs[0];
        }
      }

      if (userDoc.exists) {
        const userData = userDoc.data();
        const tokens = userData.fcmTokens; // User specified this is an array
        
        if (Array.isArray(tokens) && tokens.length > 0) {
          // Send to each token and handle results
          const results = await Promise.all(
            tokens.map(async (token) => {
              if (!token) return { success: false };
              return await sendPushNotification(token, title, message, {
                type: 'alert',
                notificationId: docRef.id
              });
            })
          );

          // Log results without deleting anything
          const successCount = results.filter(r => r.success).length;
          const failedCount = tokens.length - successCount;
          
          if (failedCount > 0) {
            console.log(`⚠️ FCM Delivery partial failure: ${failedCount} tokens failed, but NO tokens were removed from the database as per request.`);
          }
          
          console.log(`📡 Push deliverability: ${successCount}/${tokens.length} successful for user: ${notifyTo}`);
        } else {
          console.log(`⚠️ No valid tokens in fcmTokens array for user: ${notifyTo}`);
        }
      } else {
        console.log(`⚠️ User not found for FCM: ${notifyTo}`);
      }
    } catch (fcmErr) {
      console.error('❌ Error sending FCM during alert:', fcmErr);
      // We don't fail the whole request if FCM fails, as the DB notification is saved
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

module.exports = router;

