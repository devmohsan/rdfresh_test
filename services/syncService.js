const cron = require('node-cron');
const { db } = require('../firebase/db');
const admin = require('firebase-admin');

const { getSettings } = require('./settingsService');

const { sendPushNotification } = require('./fcmService');

/**
 * Handles strict notification flow: 
 * 1. Find User by Email (in specified collection)
 * 2. Send FCM Push Notification FIRST
 * 3. Save to Firestore ONLY if FCM succeeds
 */
async function triggerStrictNotification({ title, message, email, collectionName = 'users', type, data = {} }) {
    try {
        // 1. Find User to get ID and Tokens
        let userSnapshot = await db.collection(collectionName).where('email', '==', email).limit(1).get();

        // Alternative: If admin_users uses doc ID as email or has a different structure
        if (userSnapshot.empty && collectionName === 'users') {
            const doc = await db.collection('users').doc(email).get();
            if (doc.exists) {
                userSnapshot = { empty: false, docs: [doc] };
            }
        }

        if (userSnapshot.empty) {
            console.log(`⚠️ User not found for ${email} in ${collectionName}. Skipping.`);
            return;
        }

        const userDoc = userSnapshot.docs[0];
        const userId = userDoc.id;
        const userData = userDoc.data();
        const tokens = userData.fcmTokens;

        if (!Array.isArray(tokens) || tokens.length === 0) {
            console.log(`⚠️ No FCM tokens for user ${userId}. Skipping DB save per rules.`);
            return;
        }

        // 2. Send FCM Push Notification FIRST
        let anySuccess = false;
        for (const token of tokens) {
            if (!token) continue;
            const res = await sendPushNotification(token, title, message, { type, ...data });
            if (res.success) anySuccess = true;
        }

        // 3. Save to Firestore ONLY if at least one FCM message was successful
        if (anySuccess) {
            const docRef = db.collection('notifications').doc();
            await docRef.set({
                id: docRef.id,
                title,
                message,
                notifyTo: userId, // Store Document ID instead of email
                type,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                readBy: [],
                ...data
            });
            console.log(`✅ Notification recorded in DB for ${userId} (FCM Success)`);
        } else {
            console.log(`❌ FCM failure for ${userId}. Notification NOT saved to DB.`);
        }
    } catch (err) {
        console.error('❌ Error in triggerStrictNotification:', err.message);
    }
}

async function runComplianceReminders() {
    console.log('⏰ Running Compliance Reminders (24h/5-Day Check)...');
    try {
        const now = new Date();
        const unsignedSnapshot = await db.collection('orders')
            .where('status', '==', 'delivered')
            .where('signatureStatus', '==', 'unsigned')
            .get();

        for (const orderDoc of unsignedSnapshot.docs) {
            const order = orderDoc.data();
            if (!order.deliveredAt) continue;

            const deliveredAt = new Date(order.deliveredAt);
            const diffTime = Math.abs(now - deliveredAt);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            // 1. 24h Reminder (To Customer)
            await triggerStrictNotification({
                title: '✍️ Signature Required',
                message: `Reminder: Order #${order.orderNumber} is delivered. Please complete your signature.`,
                email: order.customerEmail,
                collectionName: 'users',
                type: 'signature_reminder',
                data: { orderId: orderDoc.id }
            });

            // 2. 5-Day Admin Escalation
            if (diffDays >= 5) {
                const admins = await db.collection('admin_users').get();
                for (const adminDoc of admins.docs) {
                    const adminData = adminDoc.data();
                    await triggerStrictNotification({
                        title: '⚠️ Compliance Escalation',
                        message: `Order #${order.orderNumber} (${order.customerEmail}) delivered 5+ days but unsigned.`,
                        email: adminData.email || adminDoc.id,
                        collectionName: 'admin_users',
                        type: 'admin_escalation',
                        data: { orderId: orderDoc.id }
                    });
                }
            }
        }
    } catch (err) {
        console.error('❌ Error in runComplianceReminders:', err.message);
    }
}

async function syncShipStationOrders() {
    console.log('🔄 Starting ShipStation to Firebase Sync...');
    try {
        const settings = await getSettings();
        const API_KEY = settings.API_KEY || process.env.API_KEY;
        const API_SK = settings.API_SK || process.env.API_SK;

        const auth = Buffer.from(`${API_KEY}:${API_SK}`).toString('base64');

        // Fetch last 100 orders to ensure we catch updates
        const response = await fetch('https://ssapi.shipstation.com/orders?sortDir=desc', {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`ShipStation API Error: ${response.statusText}`);
        }

        const data = await response.json();
        const orders = data.orders;

        if (!orders || orders.length === 0) {
            console.log('ℹ️ No orders found to sync.');
            return;
        }

        let updateCount = 0;

        for (const order of orders) {
            const orderId = order.orderId.toString();
            const orderRef = db.collection('orders').doc(orderId);

            const orderDate = new Date(order.orderDate);
            const createdAt = admin.firestore.Timestamp.fromDate(orderDate);

            // Prepare order data
            const orderData = {
                orderId: orderId,
                orderNumber: order.orderNumber,
                orderKey: order.orderKey,
                orderDate: order.orderDate, // Keep original string
                createdAt: createdAt,       // For view compatibility (Timestamp)
                total_amount: order.orderTotal,
                amountPaid: order.amountPaid,
                status: order.orderStatus,
                payment_status: order.paymentDate ? 'paid' : 'pending',
                customerUsername: order.customerUsername,
                customerEmail: order.customerEmail,
                billTo: order.billTo,
                shipTo: order.shipTo,
                carrierCode: order.carrierCode,
                serviceCode: order.serviceCode,
                shipDate: order.shipDate,
                company: {
                    name: order.advancedOptions?.source || 'ShipStation Store'
                },
                items: order.items.map(item => ({
                    id: item.orderItemId?.toString() || item.sku || 'N/A',
                    name: item.name,
                    sku: item.sku,
                    quantity: item.quantity,
                    price: item.unitPrice,
                    unitPrice: item.unitPrice,
                    imageUrl: item.imageUrl,
                    type: 'standard' // Default type as ShipStation items don't have veg/non-veg natively
                })),
                lastSyncAt: new Date().toISOString()
            };

            const doc = await orderRef.get();
            if (!doc.exists) {
                // New order: Initialize everything including signatureStatus
                await orderRef.set({
                    ...orderData,
                    signatureStatus: 'unsigned'
                });
            } else {
                const existingData = doc.data();

                // --- CUSTOM COMPLIANCE LOGIC: Detect Delivery ---
                if (existingData.status !== 'delivered' && orderData.status === 'delivered') {
                    console.log(`📡 Order Delivered Transition: #${orderId}`);
                    orderData.deliveredAt = new Date().toISOString();

                    // Trigger Delivery Notification to Customer
                    await triggerStrictNotification({
                        title: '📦 Order Delivered',
                        message: `Order #${orderData.orderNumber} has been delivered. Please sign to complete installation.`,
                        email: orderData.customerEmail,
                        type: 'delivery_alert',
                        data: { orderId: orderId }
                    });
                } else if (existingData.deliveredAt) {
                    // Carry forward deliveredAt if already exists
                    orderData.deliveredAt = existingData.deliveredAt;
                }

                // Existing order: Update everything EXCEPT signatureStatus
                await orderRef.update(orderData);
            }

            updateCount++;
        }

        console.log(`✅ Sync Completed: ${updateCount} orders processed.`);

    } catch (error) {
        console.error('❌ Sync Error:', error.message);
    }
}

async function syncShipStationProducts() {
    console.log('🔄 Starting ShipStation to Firebase Products Sync...');
    try {
        const settings = await getSettings();
        const API_KEY = settings.API_KEY || process.env.API_KEY;
        const API_SK = settings.API_SK || process.env.API_SK;

        const auth = Buffer.from(`${API_KEY}:${API_SK}`).toString('base64');

        const response = await fetch('https://ssapi.shipstation.com/products?pageSize=100', {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`ShipStation API Error: ${response.statusText}`);
        }

        const data = await response.json();
        const products = data.products;

        if (!products || products.length === 0) {
            console.log('ℹ️ No products found to sync.');
            return;
        }

        let syncCount = 0;

        for (const product of products) {
            // console.log('product',product);
            const productId = product.productId.toString();
            const productRef = db.collection('products').doc(productId);

            // Use the image URL from ShipStation, checking both common field names
            const ssImageUrl = product.thumbnailUrl || product.image_url || null;

            // console.log('product',product);

            const productData = {
                productId: productId,
                name: product.name,
                sku: product.sku,
                price: product.price || 29.95,
                imageUrl: ssImageUrl,
                weightOz: product.weightOz || 0,
                internalNotes: product.internalNotes || '',
                active: product.active,
                lastSyncAt: new Date().toISOString()
            };

            await productRef.set(productData, { merge: true });

            // if (ssImageUrl) {
            //     console.log(`✅ Synced product ${product.sku} with image: ${ssImageUrl}`);
            // } else {
            //     console.log(`⚠️ Product ${product.sku} synced without image (null in ShipStation)`);
            // }

            syncCount++;
        }

        // console.log(`✅ Product Sync Completed: ${syncCount} products processed.`);

    } catch (error) {
        console.error('❌ Product Sync Error:', error.message);
    }
}

// Schedule background tasks
function startSyncJob() {
    // Sync Orders every 30 mins
    cron.schedule('*/30 * * * *', () => {
        syncShipStationOrders();
        // syncShipStationProducts();
    });

    // Run Compliance Reminders every day at 9:00 AM
    cron.schedule('0 9 * * *', () => {
        runComplianceReminders();
    });

    // Run once immediately on start
    syncShipStationOrders();
    // syncShipStationProducts();
    runComplianceReminders(); // Optional: run once at startup
}

module.exports = { startSyncJob, syncShipStationOrders, syncShipStationProducts };
