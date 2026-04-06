const express = require('express');
const router = express.Router();
const quickbooks = require('../services/quickbooks');
const { db } = require('../firebase/db');

// Store tokens temporarily (in production, use database)
let qbTokens = null;

// Connect to QuickBooks
router.get('/connect', async (req, res) => {
    try {
        const authUri = await quickbooks.getAuthUri();
        res.redirect(authUri);
    } catch (error) {
        console.error('QuickBooks connect error:', error);
        req.flash('error_msg', 'Failed to connect to QuickBooks');
        res.redirect('/admin');
    }
});

// OAuth Callback
router.get('/callback', async (req, res) => {
    console.log('QB Callback received. Query:', req.query);
    try {
        // Use full URL for QuickBooks OAuth
        const fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
        console.log('Processing QB callback with URL:', fullUrl);
        
        const authResponse = await quickbooks.handleCallback(fullUrl);
        
        // Store tokens in database or session
        qbTokens = authResponse.tokens;
        
        console.log('Saving QB tokens to Firestore...');
        // Save to Firestore
        await db.collection('settings').doc('quickbooks').set({
            tokens: authResponse.tokens,
            realmId: authResponse.realmId || req.query.realmId || null,
            connectedAt: new Date().toISOString()
        });

        console.log('✅ QuickBooks settings saved successfully.');
        req.flash('success_msg', 'QuickBooks connected successfully!');
        res.redirect('/admin');
    } catch (error) {
        console.error('❌ QuickBooks callback error:', error);
        req.flash('error_msg', 'Failed to connect to QuickBooks: ' + error.message);
        res.redirect('/admin');
    }
});

// Disconnect QuickBooks
router.get('/disconnect', async (req, res) => {
    try {
        await db.collection('settings').doc('quickbooks').delete();
        qbTokens = null;
        
        req.flash('success_msg', 'QuickBooks disconnected successfully!');
        res.redirect('/admin');
    } catch (error) {
        console.error('QuickBooks disconnect error:', error);
        req.flash('error_msg', 'Failed to disconnect QuickBooks');
        res.redirect('/admin');
    }
});

// Create Customer (Manual)
router.post('/customer/create', async (req, res) => {
    try {
        // Load tokens from database
        const qbSettings = await db.collection('settings').doc('quickbooks').get();
        if (!qbSettings.exists) {
            return res.status(400).json({ 
                success: false, 
                message: 'QuickBooks not connected' 
            });
        }

        await quickbooks.validateAndRefreshToken();

        const { name, email, company } = req.body;
        const customer = await quickbooks.createCustomer({ name, email, company });

        res.json({
            success: true,
            message: 'Customer created in QuickBooks',
            customer: customer
        });
    } catch (error) {
        console.error('Create customer error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Create Invoice
router.post('/invoice/create', async (req, res) => {
    try {
        const qbSettings = await db.collection('settings').doc('quickbooks').get();
        if (!qbSettings.exists) {
            return res.status(400).json({ 
                success: false, 
                message: 'QuickBooks not connected' 
            });
        }

        await quickbooks.validateAndRefreshToken();

        const { customerId, items, tax } = req.body;
        const invoice = await quickbooks.createInvoice({ customerId, items, tax });

        res.json({
            success: true,
            message: 'Invoice created in QuickBooks',
            invoice: invoice
        });
    } catch (error) {
        console.error('Create invoice error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Create Payment
router.post('/payment/create', async (req, res) => {
    try {
        const qbSettings = await db.collection('settings').doc('quickbooks').get();
        if (!qbSettings.exists) {
            return res.status(400).json({ 
                success: false, 
                message: 'QuickBooks not connected' 
            });
        }

        await quickbooks.validateAndRefreshToken();

        const { customerId, invoiceId, amount } = req.body;
        const payment = await quickbooks.createPayment({ customerId, invoiceId, amount });

        res.json({
            success: true,
            message: 'Payment recorded in QuickBooks',
            payment: payment
        });
    } catch (error) {
        console.error('Create payment error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Create Sales Receipt (Direct Payment)
router.post('/sales-receipt/create', async (req, res) => {
    try {
        const qbSettings = await db.collection('settings').doc('quickbooks').get();
        if (!qbSettings.exists) {
            return res.status(400).json({ 
                success: false, 
                message: 'QuickBooks not connected' 
            });
        }

        await quickbooks.validateAndRefreshToken();

        const { customerId, items, total } = req.body;
        const receipt = await quickbooks.createSalesReceipt({ customerId, items, total });

        res.json({
            success: true,
            message: 'Sales receipt created in QuickBooks',
            receipt: receipt
        });
    } catch (error) {
        console.error('Create sales receipt error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Check QuickBooks Connection Status
router.get('/status', async (req, res) => {
    try {
        const qbSettings = await db.collection('settings').doc('quickbooks').get();
        
        if (qbSettings.exists) {
            res.json({
                connected: true,
                connectedAt: qbSettings.data().connectedAt,
                realmId: qbSettings.data().realmId
            });
        } else {
            res.json({
                connected: false
            });
        }
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
