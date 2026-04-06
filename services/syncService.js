const cron = require('node-cron');
const { db } = require('../firebase/db');
const admin = require('firebase-admin');

const { getSettings } = require('./settingsService');

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
                // Skip update if status is already 'delivered'
                if (existingData.status === 'delivered') {
                    console.log(`ℹ️ Skipping update for order #${orderId} - already 'delivered'`);
                    continue;
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

// Schedule the task to run every 15 minutes
function startSyncJob() {
    cron.schedule('*/30 * * * *', () => {
        syncShipStationOrders();
        // syncShipStationProducts();
    });

    // Run once immediately on start
    syncShipStationOrders();
    // syncShipStationProducts();
}

module.exports = { startSyncJob, syncShipStationOrders, syncShipStationProducts };
