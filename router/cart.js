const express = require('express');
const router = express.Router();
const { db } = require('../firebase/db');
const jwt = require('jsonwebtoken');

// Custom authentication middleware for cart (handles both API and page requests)
const cartAuth = (req, res, next) => {
    const token = req.cookies?.token;
    
    if (!token) {
        // Check if this is an API request
        const isApiRequest = req.xhr || 
                            req.headers.accept?.indexOf('json') > -1 || 
                            req.path.includes('/add') || 
                            req.path.includes('/update') || 
                            req.path.includes('/remove') || 
                            req.path.includes('/count');
        
        if (isApiRequest) {
            return res.status(401).json({ 
                success: false, 
                message: 'Please login to access cart',
                redirectTo: '/login'
            });
        }
        
        req.flash('error_msg', 'Please login to access cart');
        return res.redirect('/login');
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        // Invalid/expired token
        const isApiRequest = req.xhr || 
                            req.headers.accept?.indexOf('json') > -1 || 
                            req.path.includes('/add') || 
                            req.path.includes('/update') || 
                            req.path.includes('/remove') || 
                            req.path.includes('/count');
        
        if (isApiRequest) {
            return res.status(401).json({ 
                success: false, 
                message: 'Session expired. Please login again.',
                redirectTo: '/login'
            });
        }
        
        req.flash('error_msg', 'Session expired. Please login again.');
        res.redirect('/login');
    }
};

// Get cart page
router.get('/', cartAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const cartRef = db.collection('carts').doc(userId);
        const cartDoc = await cartRef.get();
        
        
        console.log('db docs', cartDoc);
        let cartItems = [];
        let total = 0;
        
        if (cartDoc.exists) {
            const cartData = cartDoc.data();
            cartItems = cartData.items || [];
            total = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            
            console.log('total', total);
        }else{
            cartItems = [];
        }
        
        res.render('website/cart', {
            title: 'Shopping Cart - RD Fresh',
            user: req.user,
            cartItems,
            total,
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg')
        });
    } catch (error) {
        console.error('Error fetching cart:', error);
        req.flash('error_msg', 'Error loading cart');
        res.redirect('/shop');
    }
});

// Checkout page
router.get('/checkout', cartAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const cartRef = db.collection('carts').doc(userId);
        const cartDoc = await cartRef.get();
        
        let cartItems = [];
        let total = 0;
        
        if (cartDoc.exists) {
            cartItems = cartDoc.data().items || [];
            total = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        }
        
        if (cartItems.length === 0) {
            req.flash('error_msg', 'Your cart is empty');
            return res.redirect('/cart');
        }
        
        // Fetch full user profile for pre-filling
        const userDoc = await db.collection('users').doc(userId).get();
        const fullUser = userDoc.exists ? userDoc.data() : req.user;
        
        res.render('website/checkout', {
            user: fullUser,
            cartItems,
            total,
            error_msg: req.flash('error_msg'),
            footerPath: 'partials/footer'
        });
    } catch (error) {
        console.error('Error loading checkout:', error);
        req.flash('error_msg', 'Error loading checkout');
        res.redirect('/cart');
    }
});

// Process checkout with QuickBooks
router.post('/checkout', cartAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { billingInfo } = req.body;
        console.log('Checkout request received for user:', userId);
        console.log('Billing Info:', billingInfo ? 'Received' : 'MISSING');
        
        if (!billingInfo) {
            return res.status(400).json({
                success: false,
                message: 'Billing information is required'
            });
        }
        
        // Get cart items
        const cartRef = db.collection('carts').doc(userId);
        const cartDoc = await cartRef.get();
        
        if (!cartDoc.exists || !cartDoc.data().items || cartDoc.data().items.length === 0) {
            console.log('Checkout failed: Cart is empty');
            return res.status(400).json({
                success: false,
                message: 'Cart is empty'
            });
        }
        
        const cartItems = cartDoc.data().items;
        const total = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const tax = total * 0.08;
        const grandTotal = total + tax;
        
        // Get user data
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data();
        
        // Initialize QuickBooks
        const quickbooks = require('../services/quickbooks');
        const qbSettings = await db.collection('settings').doc('quickbooks').get();
        
        let qbCustomerId = userData?.quickbooksCustomerId || null;
        let qbReceipt = null;
        let qbError = null;
        
        // Only try QuickBooks if connected
        if (qbSettings.exists) {
            console.log('QuickBooks is connected, processing payment...');
            
            try {
                // Ensure tokens are valid and client is initialized
                await quickbooks.validateAndRefreshToken();
                
                // Create or get customer in QuickBooks
                if (!qbCustomerId) {
                    console.log('Creating new QB customer...');
                    try {
                        const qbCustomer = await quickbooks.createCustomer({
                            name: `${billingInfo.firstName} ${billingInfo.lastName}`,
                            email: billingInfo.email,
                            company: userData?.company || ''
                        });
                        qbCustomerId = qbCustomer.Id;
                        console.log('QB Customer created:', qbCustomerId);
                        
                        // Save QB customer ID
                        await db.collection('users').doc(userId).update({
                            quickbooksCustomerId: qbCustomerId
                        });
                    } catch (error) {
                        console.error('QuickBooks customer creation error:', error.message);
                        qbError = error.message;
                    }
                } else {
                    console.log('Using existing QB customer:', qbCustomerId);
                }
                
                // Create sales receipt in QuickBooks
                if (qbCustomerId) {
                    console.log('Creating QB sales receipt...');
                    try {
                        qbReceipt = await quickbooks.createSalesReceipt({
                            customerId: qbCustomerId,
                            items: cartItems,
                            total: grandTotal
                        });
                        console.log('QB Sales Receipt created:', qbReceipt.Id);
                    } catch (error) {
                        console.error('QuickBooks sales receipt error:', error.message);
                        qbError = error.message;
                    }
                }
            } catch (error) {
                console.error('QuickBooks initialization error:', error.message);
                qbError = error.message;
            }
        } else {
            console.log('⚠️ QuickBooks not connected. Order will be saved without QB integration.');
            console.log('To connect QuickBooks, visit: /quickbooks/connect');
            qbError = 'QuickBooks not connected';
        }
        
        // ---- ShipStation Order Creation ----
        let shipStationOrderId = null;
        let shipStationError = null;

        try {
            console.log('Creating order in ShipStation...');
            const auth = Buffer.from(`${process.env.API_KEY}:${process.env.API_SK}`).toString('base64');
            
            const ssOrderData = {
                orderNumber: `RDF-${Date.now()}`,
                orderDate: new Date().toISOString(),
                orderStatus: 'awaiting_shipment',
                customerEmail: billingInfo.email,
                billTo: {
                    name: `${billingInfo.firstName} ${billingInfo.lastName}`,
                    company: userData?.company || '',
                    street1: billingInfo.address,
                    city: billingInfo.city,
                    state: billingInfo.state,
                    postalCode: billingInfo.zip,
                    country: 'US',
                    phone: billingInfo.phone
                },
                shipTo: {
                    name: `${billingInfo.firstName} ${billingInfo.lastName}`,
                    company: userData?.company || '',
                    street1: billingInfo.address,
                    city: billingInfo.city,
                    state: billingInfo.state,
                    postalCode: billingInfo.zip,
                    country: 'US',
                    phone: billingInfo.phone
                },
                items: cartItems.map(item => ({
                    name: item.productName,
                    sku: item.sku || 'N/A',
                    quantity: item.quantity,
                    unitPrice: item.price
                })),
                amountPaid: grandTotal,
                taxAmount: tax,
                shippingAmount: 0,
                internalNotes: `Order from RD Fresh Website. QB Receipt: ${qbReceipt?.Id || 'N/A'}`
            };

            const ssResponse = await fetch('https://ssapi.shipstation.com/orders/createorder', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(ssOrderData)
            });

            const ssResult = await ssResponse.json();
            if (ssResponse.ok) {
                shipStationOrderId = ssResult.orderId;
                console.log('✅ ShipStation Order created:', shipStationOrderId);
            } else {
                console.error('❌ ShipStation API Error:', ssResult);
                shipStationError = ssResult.message || 'Failed to create ShipStation order';
            }
        } catch (error) {
            console.error('❌ ShipStation connection error:', error.message);
            shipStationError = error.message;
        }

        // Create order in Firestore
        const orderData = {
            userId,
            customerName: `${billingInfo.firstName} ${billingInfo.lastName}`,
            email: billingInfo.email,
            phone: billingInfo.phone,
            billingAddress: {
                address: billingInfo.address,
                city: billingInfo.city,
                state: billingInfo.state,
                zip: billingInfo.zip
            },
            items: cartItems,
            subtotal: total,
            tax: tax,
            total: grandTotal,
            status: 'completed',
            paymentMethod: qbReceipt ? 'QuickBooks' : 'Manual',
            quickbooksReceiptId: qbReceipt?.Id || null,
            quickbooksCustomerId: qbCustomerId || null,
            quickbooksError: qbError || null,
            shipStationOrderId: shipStationOrderId,
            shipStationError: shipStationError,
            quickbooksConnected: qbSettings.exists && qbSettings.data().tokens ? true : false,
            createdAt: new Date().toISOString()
        };
        
        // Clear cart
        await cartRef.delete();
        
        res.json({
            success: true,
            message: 'Payment and Order processed successfully',
            orderId: shipStationOrderId, // Use ShipStation ID instead of Firestore ID
            quickbooksReceiptId: qbReceipt?.Id
        });
        
    } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json({
            success: false,
            message: 'Order processing failed. Please try again.'
        });
    }
});

// Add item to cart
router.post('/add', cartAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId, productName, price, image, quantity = 1 } = req.body;
        
        const cartRef = db.collection('carts').doc(userId);
        const cartDoc = await cartRef.get();
        
        let cartItems = [];
        
        if (cartDoc.exists) {
            cartItems = cartDoc.data().items || [];
        }
        
        // Check if product already exists in cart
        const existingItemIndex = cartItems.findIndex(item => item.productId === productId);
        
        if (existingItemIndex > -1) {
            // Update quantity
            cartItems[existingItemIndex].quantity += parseInt(quantity);
        } else {
            // Add new item
            cartItems.push({
                productId,
                productName,
                price: parseFloat(price),
                image,
                quantity: parseInt(quantity),
                addedAt: new Date().toISOString()
            });
        }
        
        await cartRef.set({
            userId,
            items: cartItems,
            updatedAt: new Date().toISOString()
        });
        
        req.flash('success_msg', `${productName} added to cart!`);
        res.json({ success: true, message: 'Product added to cart', cartCount: cartItems.length });
    } catch (error) {
        console.error('Error adding to cart:', error);
        res.status(500).json({ success: false, message: 'Error adding to cart' });
    }
});

// Update cart item quantity
router.post('/update', cartAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId, quantity } = req.body;
        
        const cartRef = db.collection('carts').doc(userId);
        const cartDoc = await cartRef.get();
        
        if (cartDoc.exists) {
            let cartItems = cartDoc.data().items || [];
            const itemIndex = cartItems.findIndex(item => item.productId === productId);
            
            if (itemIndex > -1) {
                if (parseInt(quantity) <= 0) {
                    // Remove item if quantity is 0 or less
                    cartItems.splice(itemIndex, 1);
                } else {
                    cartItems[itemIndex].quantity = parseInt(quantity);
                }
                
                await cartRef.update({
                    items: cartItems,
                    updatedAt: new Date().toISOString()
                });
                
                // Calculate new totals
                const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
                const tax = subtotal * 0.08;
                const total = subtotal + tax;

                res.json({ 
                    success: true, 
                    message: 'Cart updated',
                    totals: {
                        subtotal,
                        tax,
                        total
                    },
                    cartCount: cartItems.length
                });
            } else {
                res.status(404).json({ success: false, message: 'Item not found in cart' });
            }
        } else {
            res.status(404).json({ success: false, message: 'Cart not found' });
        }
    } catch (error) {
        console.error('Error updating cart:', error);
        res.status(500).json({ success: false, message: 'Error updating cart' });
    }
});

// Remove item from cart
router.post('/remove', cartAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId } = req.body;
        
        const cartRef = db.collection('carts').doc(userId);
        const cartDoc = await cartRef.get();
        
        if (cartDoc.exists) {
            let cartItems = cartDoc.data().items || [];
            cartItems = cartItems.filter(item => item.productId !== productId);
            
            await cartRef.update({
                items: cartItems,
                updatedAt: new Date().toISOString()
            });
            
            req.flash('success_msg', 'Item removed from cart');
            // Calculate new totals
            const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const tax = subtotal * 0.08;
            const total = subtotal + tax;

            res.json({ 
                success: true, 
                message: 'Item removed from cart',
                totals: {
                    subtotal,
                    tax,
                    total
                },
                cartCount: cartItems.length
            });
        } else {
            res.status(404).json({ success: false, message: 'Cart not found' });
        }
    } catch (error) {
        console.error('Error removing from cart:', error);
        res.status(500).json({ success: false, message: 'Error removing item' });
    }
});

// Clear cart
router.post('/clear', cartAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const cartRef = db.collection('carts').doc(userId);
        
        await cartRef.set({
            userId,
            items: [],
            updatedAt: new Date().toISOString()
        });
        
        req.flash('success_msg', 'Cart cleared');
        res.redirect('/cart');
    } catch (error) {
        console.error('Error clearing cart:', error);
        req.flash('error_msg', 'Error clearing cart');
        res.redirect('/cart');
    }
});

// Get cart count (for header badge)
router.get('/count', cartAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const cartRef = db.collection('carts').doc(userId);
        const cartDoc = await cartRef.get();
        
        let count = 0;
        if (cartDoc.exists) {
            const cartItems = cartDoc.data().items || [];
            count = cartItems.length;
        }
        
        res.json({ count });
    } catch (error) {
        console.error('Error getting cart count:', error);
        res.json({ count: 0 });
    }
});

module.exports = router;
