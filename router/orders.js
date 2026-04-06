const express = require('express');
const router = express.Router();
const authentication = require('../middleware/auth');
const { db, storage } = require('../firebase/db');
const { getSettings } = require('../services/settingsService');



async function getShipStationOrders() {
    try {
        const settings = await getSettings();
        const API_KEY = settings.API_KEY || process.env.API_KEY;
        const API_SK = settings.API_SK || process.env.API_SK;

        const auth = Buffer.from(`${API_KEY}:${API_SK}`).toString('base64');
        const response = await fetch('https://ssapi.shipstation.com/orders?sortDir=desc', {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`ShipStation Error: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Map ShipStation data to our UI format while preserving original fields
        return data.orders.map(order => ({
            id: order.orderId.toString(),
            orderNumber: order.orderNumber,
            orderKey: order.orderKey,
            createdAt: order.orderDate,
            orderDate: order.orderDate,
            total_amount: order.orderTotal,
            amountPaid: order.amountPaid,
            taxAmount: order.taxAmount,
            shippingAmount: order.shippingAmount,
            status: order.orderStatus,
            payment_status: order.paymentDate ? 'paid' : 'pending',
            customerUsername: order.customerUsername,
            customerEmail: order.customerEmail,
            billTo: order.billTo,
            shipTo: order.shipTo,
            carrierCode: order.carrierCode,
            serviceCode: order.serviceCode,
            packageCode: order.packageCode,
            confirmation: order.confirmation,
            shipDate: order.shipDate,
            user: {
                name: order.billTo.name || order.shipTo.name || 'Anonymous',
                email: order.customerEmail || 'No Email'
            },
            company: {
                name: order.advancedOptions?.source || 'ShipStation Store'
            },
            items: order.items.map(item => ({
                lineItemKey: item.lineItemKey,
                name: item.name,
                sku: item.sku,
                quantity: item.quantity,
                price: item.unitPrice,
                imageUrl: item.imageUrl
            }))
        }));
    } catch (error) {
        console.error('ShipStation API Fetch Error:', error);
        return [];
    }

}

async function getShipStationOrder(orderId) {
    try {
        const settings = await getSettings();
        const API_KEY = settings.API_KEY || process.env.API_KEY;
        const API_SK = settings.API_SK || process.env.API_SK;

        const auth = Buffer.from(`${API_KEY}:${API_SK}`).toString('base64');
        const response = await fetch(`https://ssapi.shipstation.com/orders/${orderId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`ShipStation Error (${response.status}): ${response.statusText}`);
            return null;
        }

        const order = await response.json();
        
        // Map ShipStation data to our UI format
        return {
            id: order.orderId.toString(),
            orderNumber: order.orderNumber,
            orderKey: order.orderKey,
            createdAt: order.orderDate,
            orderDate: order.orderDate,
            total_amount: order.orderTotal,
            amountPaid: order.amountPaid,
            taxAmount: order.taxAmount,
            shippingAmount: order.shippingAmount,
            status: order.orderStatus,
            payment_status: order.paymentDate ? 'paid' : 'pending',
            customerUsername: order.customerUsername,
            customerEmail: order.customerEmail,
            billTo: order.billTo,
            shipTo: order.shipTo,
            carrierCode: order.carrierCode,
            serviceCode: order.serviceCode,
            packageCode: order.packageCode,
            confirmation: order.confirmation,
            shipDate: order.shipDate,
            items: order.items.map(item => ({
                lineItemKey: item.lineItemKey,
                name: item.name,
                sku: item.sku,
                quantity: item.quantity,
                price: item.unitPrice,
                imageUrl: item.imageUrl
            }))
        };
    } catch (error) {
        console.error('ShipStation Single Order Fetch Error:', error);
        return null;
    }
}

async function getShipStationProducts() {
    try {
        const settings = await getSettings();
        const API_KEY = settings.API_KEY || process.env.API_KEY;
        const API_SK = settings.API_SK || process.env.API_SK;

        const auth = Buffer.from(`${API_KEY}:${API_SK}`).toString('base64');
        const response = await fetch('https://ssapi.shipstation.com/products', {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`ShipStation Products Error: ${response.statusText}`);
            return [];
        }

        const data = await response.json();
        return data.products || [];

    } catch (error) {
        console.error('ShipStation Products Fetch Error:', error);
        return [];
    }
}

router.get('/', authentication, async (req, res) => {
    try {
        const user = req.user;
        const page = parseInt(req.query.page) || 1;
        const limit = 10; 

        // 🔹 Fetch Data from Firestore (Synced from ShipStation)
        // Ordering by orderDate descending
        const snapshot = await db.collection('orders')
            .orderBy('orderDate', 'desc')
            .get();
        
        const allOrders = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            // Ensure compatibility with existing template expectations
            user: {
                name: doc.data().billTo?.name || doc.data().shipTo?.name || 'Anonymous',
                email: doc.data().customerEmail || 'No Email'
            }
        }));
        
        const totalOrders = allOrders.length;
        const totalPages = Math.ceil(totalOrders / limit);
        const startAt = (page - 1) * limit;

        // 🔹 Apply pagination
        const orders = allOrders.slice(startAt, startAt + limit);

        res.render('orders', {
            orders,
            page,
            totalPages,
            totalOrders,
            admin: user
        });

    } catch (error) {
        console.log(error);
        req.flash('errors', 'Unable to fetch orders from database');
        res.redirect('/admin/dashboard');
    }
});


router.post('/status/:id', authentication, async (req, res) => {
    try {
        const orderId = req.params.id;
        const orderRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            throw new Error('Order not found');
        }

        const orderData = orderDoc.data();
        const newStatus = req.body.status;

        await orderRef.update({
            status: newStatus
        });

        req.flash('success', 'Order status updated successfully');
        res.redirect('/admin/orders');

    } catch (error) {
        console.log(error);
        req.flash('errors', 'Failed to update order status');
        res.redirect('/admin/orders');
    }
});

router.post('/payment/:id', authentication, async (req, res) => {
    try {
        const orderId = req.params.id;
        const orderRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();
        const newStatus = req.body.payment_status;

        if (!orderDoc.exists) {
            throw new Error('Order not found');
        }

        await orderRef.update({
            payment_status: newStatus
        });

        req.flash('success', 'Order marked as paid successfully');
        res.redirect('/admin/orders');

    } catch (error) {
        console.log(error);
        req.flash('errors', 'Failed to mark order as paid');
        res.redirect('/admin/orders');
    }
}); 

router.get('/view/:id', authentication, async (req, res) => {
    try {
        const orderId = req.params.id;
        const orderRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            throw new Error('Order not found');
        }

        const orderData = orderDoc.data();

        // ShipStation orders now have items inside the document from our sync
        // We can just use orderData.items directly
        const order = {
            id: orderDoc.id,
            ...orderData,
            // Ensure compatibility with view expectations
            user: {
                id: orderData.userId || 'N/A',
                name: orderData.billTo?.name || orderData.shipTo?.name || 'Anonymous',
                email: orderData.customerEmail || 'No Email',
                phone: orderData.billTo?.phone || 'N/A'
            },
            // The items are already in orderData.items from syncService
            items: orderData.items || []
        };

        res.render('order_view', { order });

    } catch (error) {
        console.log(error);
        req.flash('errors', 'Unable to view order');
        res.redirect('/admin/orders');
    }
});



router.get('/edit/:id', authentication, async (req, res) => {
    try {
        const orderId = req.params.id;
        const orderRef = db.collection('orders').doc(orderId);
        
        // 1. Fetch fresh data from ShipStation
        console.log(`Fetching ShipStation order for edit: ${orderId}`);
        const shipStationOrder = await getShipStationOrder(orderId);
        
        // 2. Fetch ALL products from ShipStation to build the catalog
        console.log('Fetching all ShipStation products...');
        const allProducts = await getShipStationProducts();

        console.log('ShipStation Order:', shipStationOrder);
        console.log('All Products:', allProducts);

        // 2. Merge with local data
        let orderData;
        if (shipStationOrder) {
             const docSnap = await orderRef.get();
             const existingData = docSnap.exists ? docSnap.data() : {};
             
             orderData = {
                 ...existingData,
                 ...shipStationOrder
             };
             await orderRef.set(orderData, { merge: true });
        } else {
             const orderDoc = await orderRef.get();
             if (!orderDoc.exists) throw new Error('Order not found');
             orderData = orderDoc.data();
        }

        const order = {
            id: orderId,
            ...orderData
        };

        res.render('order_edit', { order, products: allProducts, admin: req.user });

    } catch (error) {
        console.log(error);
        req.flash('errors', 'Unable to load order for editing');
        res.redirect('/admin/orders');
    }
});

router.post('/update/:id', authentication, async (req, res) => {
    try {
        const orderId = req.params.id;
        const orderRef = db.collection('orders').doc(orderId);

        // console.log()
        
        // Items come in as array of objects
        // We expect the frontend to send the FINAL list of items in the order
        // req.body.items = [ { sku, name, quantity, price, imageUrl, ... }, ... ]
        // console.log('Update Order Request Body:', JSON.stringify(req.body, null, 2));

        let { items } = req.body;

        // Clean up items (filter out invalid or zero qty)
        // Robustly handle if items is an object (pseudo-array) instead of real array
        if (items && typeof items === 'object' && !Array.isArray(items)) {
            items = Object.values(items);
        }

        if (!items || !Array.isArray(items)) {
            items = [];
        }

        // 1. Fetch RAW order from ShipStation to get the full payload we need to send back
        const settings = await getSettings();
        const API_KEY = settings.API_KEY || process.env.API_KEY;
        const API_SK = settings.API_SK || process.env.API_SK;

        const auth = Buffer.from(`${API_KEY}:${API_SK}`).toString('base64');
        const getResponse = await fetch(`https://ssapi.shipstation.com/orders/${orderId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        });

        if (!getResponse.ok) {
            throw new Error(`Failed to fetch current order from ShipStation: ${getResponse.statusText}`);
        }

        const rawOrder = await getResponse.json();

        console.log('Raw Order from ShipStation:', rawOrder);

        // 2. Prepare the Updated Items List for ShipStation
        // ShipStation expects: { sku, name, quantity, unitPrice, ... }
        // We need to preserve existing lineItemKeys where possible if we want to be clean, 
        // but replacing the list is usually acceptable.
        
        // 2. Prepare the Updated Items List for ShipStation
        let newTotal = 0;
        const formattedItems = items.map(item => {
            const qty = parseInt(item.quantity) || 0;
            const price = parseFloat(item.price) || 0;
            newTotal += qty * price;

            const lineItem = {
                sku: item.sku,
                name: item.name,
                imageUrl: item.imageUrl,
                quantity: qty,
                unitPrice: price,
                warehouseLocation: item.warehouseLocation || null,
                options: item.options || []
            };

            // Only attach lineItemKey if it exists and is valid
            if (item.lineItemKey && item.lineItemKey !== 'null' && item.lineItemKey !== '') {
                lineItem.lineItemKey = item.lineItemKey;
            }

            return lineItem;
        }).filter(item => item.quantity > 0);

        // 3. Update the Raw Order Object
        // IMPORTANT: Ensure we are sending valid fields for update
        rawOrder.items = formattedItems;
        rawOrder.orderTotal = newTotal + (rawOrder.taxAmount || 0) + (rawOrder.shippingAmount || 0);

        // If weight is not recalculated properly, ShipStation might default to 0 used in simple updates. 
        // We generally trust ShipStation to re-calc weight based on product SKU if configured, 
        // but if we are editing, we are just sending the items.

        // console.log('Sending Update Payload to ShipStation:', JSON.stringify(rawOrder, null, 2));

        // 4. Send Update to ShipStation (POST /orders/createorder updates if orderId exists)
        const updateResponse = await fetch('https://ssapi.shipstation.com/orders/createorder', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(rawOrder)
        });

        if (!updateResponse.ok) {
            const errText = await updateResponse.text();
            throw new Error(`ShipStation Update Failed: ${errText}`);
        }

        const updatedSSOrder = await updateResponse.json();

        // console.log('Updated Order from ShipStation:', updatedSSOrder);

        // 5. Update Local Firestore with the result from ShipStation (source of truth)
        // Store the mapped version similar to getShipStationOrder
        const mappedOrderForDB = {
            id: updatedSSOrder.orderId.toString(),
            orderNumber: updatedSSOrder.orderNumber,
            orderKey: updatedSSOrder.orderKey,
            createdAt: updatedSSOrder.orderDate,
            orderDate: updatedSSOrder.orderDate,
            total_amount: updatedSSOrder.orderTotal,
            // ... map other fields if necessary, but importantly items
            items: updatedSSOrder.items.map(item => ({
                name: item.name,
                sku: item.sku,
                quantity: item.quantity,
                price: item.unitPrice,
                imageUrl: item.imageUrl
            })),
            lastSyncAt: new Date().toISOString()
        };

        // Merge with existing to keep fields SS might not return or that we added
        await orderRef.set(mappedOrderForDB, { merge: true });

        req.flash('success', 'Order updated successfully in ShipStation and Database');
        res.redirect(`/admin/orders/view/${orderId}`);

    } catch (error) {
        console.error('Update Order Error:', error);
        req.flash('errors', `Failed to update order: ${error.message}`);
        res.redirect(`/admin/orders/edit/${req.params.id}`);
    }
});

module.exports = router;