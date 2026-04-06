const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('../firebase/db');
const { getSettings } = require('../services/settingsService');

// Landing Page
router.get('/', async (req, res) => {
    try {
        const productsSnapshot = await db.collection('products').where('active', '==', true).get();
        const products = [];
        productsSnapshot.forEach(doc => {
            products.push({ id: doc.id, ...doc.data() });
        });

        // Fetch FAQs from Firestore
        const faqsSnapshot = await db.collection('faqs').orderBy('createdAt', 'desc').get();
        const faqs = [];
        faqsSnapshot.forEach(doc => {
            const data = doc.data();
            // console.log(`FAQ Trace - ID: ${doc.id}, Data:`, data);
            faqs.push({ id: doc.id, ...data });
        });

        res.render('website/index', { 
            title: 'RD Fresh - Delivering Freshness',
            products: products,
            faqs: faqs
        });
    } catch (error) {
        console.error('Error fetching data for landing page:', error);
        res.render('website/index', { 
            title: 'RD Fresh - Delivering Freshness',
            products: [],
            faqs: []
        });
    }
});

const { userAuth, ndaGuard } = require('../middleware/websiteAuth');

// 🔹 Neutralize Admin Sessions for Website
// This ensures that even if an admin is logged in, they are treated as a guest on the website side.
router.use((req, res, next) => {
    if (res.locals.user && res.locals.user.role === 'admin') {
        res.locals.user = null;
    }
    next();
});

// Apply NDA Gatekeeper globally to website routes
router.use(ndaGuard);

// My Orders Page
router.get('/my-orders', userAuth, async (req, res) => {
    try {
        const userEmail = res.locals.user.email;
        
        // Fetch orders where customerEmail matches logged-in user's email
        const ordersSnapshot = await db.collection('orders')
            .where('customerEmail', '==', userEmail)
            .orderBy('orderDate', 'desc')
            .get();
        
        const orders = [];
        ordersSnapshot.forEach(doc => {
            orders.push({ id: doc.id, ...doc.data() });
        });

        // console.log('orders', orders)

        res.render('website/my-orders', { 
            title: 'My Orders - RD Fresh',
            orders: orders
        });
    } catch (error) {
        console.error('Error fetching user orders:', error);
        res.render('website/my-orders', { 
            title: 'My Orders - RD Fresh',
            orders: [],
            error: 'Unable to load orders at this time.'
        });
    }
});

// My Order Details Page
router.get('/my-orders/:id', userAuth, async (req, res) => {
    try {
        const orderId = req.params.id;
        const userEmail = res.locals.user.email;
        
        const orderDoc = await db.collection('orders').doc(orderId).get();
        
        if (!orderDoc.exists) {
            req.flash('errors', 'Order not found.');
            return res.redirect('/my-orders');
        }

        const order = { id: orderDoc.id, ...orderDoc.data() };

        // Security check: ensure this order belongs to the person requesting it
        if (order.customerEmail !== userEmail) {
            req.flash('errors', 'You do not have permission to view this order.');
            return res.redirect('/my-orders');
        }

        res.render('website/my-order-details', { 
            title: `Order #${order.orderNumber || order.id} - RD Fresh`,
            order: order
        });
    } catch (error) {
        console.error('Error fetching order details:', error);
        req.flash('errors', 'Unable to load order details.');
        res.redirect('/my-orders');
    }
});

// About Page (Placeholder)
router.get('/about', (req, res) => {
    res.render('website/about', { title: 'About Us - RD Fresh' });
});

// Resources Page (Dashboard for customers and distributors)
router.get('/resources', userAuth, async (req, res) => {
    try {
        const user = res.locals.user;
        let sections = [];

        let howItWorksDoc = null;
        if (user && user.role === 'distributor') {
            // 1. Fetch Distributor Resources ONLY
            const distributorDoc = await db.collection('document_library').doc('distributor_resources').get();
            if (distributorDoc.exists) {
                const data = distributorDoc.data();
                if (data.sections) {
                    sections = [...data.sections];
                    
                    // Extract specific document for "How It Works" tab
                    const clientLitSection = sections.find(s => s.title.toLowerCase().includes('client literature'));
                    if (clientLitSection) {
                        howItWorksDoc = clientLitSection.documents.find(d => 
                            d.title.toLowerCase().includes('how rd fresh works') || 
                            d.title.toLowerCase().includes('how it works')
                        );
                    }
                }
            }
        } else if (user && user.role === 'affiliate') {
            // 2. Fetch Affiliate Resources (Try specific, fallback to customer if needed)
            const affiliateDoc = await db.collection('document_library').doc('affiliate_resources').get();
            if (affiliateDoc.exists) {
                const data = affiliateDoc.data();
                if (data.sections) {
                    sections = [...data.sections];
                }
            } else {
                // Fallback to customer resources for now
                const customerDoc = await db.collection('document_library').doc('customer_resources').get();
                if (customerDoc.exists) {
                    const data = customerDoc.data();
                    if (data.sections) {
                        sections = [...data.sections];
                    }
                }
            }
        } else {
            // 3. Fetch Customer Resources ONLY
            const customerDoc = await db.collection('document_library').doc('customer_resources').get();
            if (customerDoc.exists) {
                const data = customerDoc.data();
                if (data.sections) {
                    sections = [...data.sections];
                }
            }
        }

        let pageTitle = 'Customer Resources - RD Fresh';
        if (user.role === 'distributor') {
            pageTitle = 'Distributor Command Center - RD Fresh';
        } else if (user.role === 'affiliate') {
            pageTitle = 'Affiliate Creator Studio - RD Fresh';
        }

        res.render('website/resources', { 
            title: pageTitle,
            sections: sections,
            user: user,
            howItWorksDoc: howItWorksDoc
        });
    } catch (error) {
        console.error('Error fetching resources:', error);
        res.render('website/resources', { 
            title: 'Resources - RD Fresh',
            sections: [],
            user: res.locals.user,
            error: 'Unable to load resources at this time.'
        });
    }
});

// Shop / Products Page
router.get('/shop', async (req, res) => {
    try {
        const user = res.locals.user;
        let query = db.collection('products').where('active', '==', true);

        // Filter based on role
        if (user && user.role === 'distributor') {
            query = query.where('visibility', '==', 'distributor');
        } else if (user && user.role === 'affiliate') {
            query = query.where('visibility', '==', 'affiliate').orderBy('seq', 'asc');
        } else {
            // Default for customers and guests
            query = query.where('visibility', '==', 'customer');
        }

        const productsSnapshot = await query.get();
        let products = [];
        productsSnapshot.forEach(doc => {
            products.push({ id: doc.id, ...doc.data() });
        });

        let shopTitle = 'RD Fresh Products - Professional Solutions';
        if (user && user.role === 'distributor') {
            shopTitle = 'Distributor Catalog - RD Fresh';
        } else if (user && user.role === 'affiliate') {
            shopTitle = 'Affiliate Partner Catalog - RD Fresh';
        }

        res.render('website/shop', { 
            title: shopTitle,
            products: products
        });
    } catch (error) {
        console.error('Error fetching products:', error);
        res.render('website/shop', { 
            title: 'RD Fresh Products - Professional Solutions',
            products: [] 
        });
    }
});

// Product Details Page
router.get('/product/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const user = res.locals.user;
        
        const doc = await db.collection('products').doc(id).get();
        if (!doc.exists) {
            req.flash('errors', 'Product not found.');
            return res.redirect('/shop');
        }

        const product = { id: doc.id, ...doc.data() };

        // 🔹 Visibility Check Logic 🔹
        // Only allow viewing if user's role matches product visibility
        const userRole = (user && user.role) ? user.role : 'customer';
        
        // If product is distributor visibility, only distributors can view
        if (product.visibility === 'distributor' && userRole !== 'distributor') {
            req.flash('errors', 'You do not have permission to view this professional product.');
            return res.redirect('/shop');
        }
        
        // If product is affiliate visibility, only affiliates can view
        if (product.visibility === 'affiliate' && userRole !== 'affiliate') {
            req.flash('errors', 'This product is reserved for Affiliate Partners.');
            return res.redirect('/shop');
        }

        res.render('website/product-details', { 
            title: `${product.name} - RD Fresh`,
            product: product
        });
    } catch (error) {
        console.error('Error fetching product details:', error);
        res.redirect('/shop');
    }
});

// Contact Page (Placeholder)
router.get('/contact', (req, res) => {
    res.render('website/contact', { title: 'Contact Us - RD Fresh' });
});

// Distributor Inquiry Page
router.get('/distributor-inquiry', (req, res) => {
    res.render('website/distributor-inquiry', { 
        title: 'Become a Distributor - RD Fresh Partnership'
    });
});

// Affiliate Inquiry Page
router.get('/affiliate-inquiry', (req, res) => {
    res.render('website/affiliate-inquiry', { 
        title: 'Become an Affiliate - RD Fresh Network'
    });
});

// Handle Distributor Inquiry Submission
router.post('/distributor-inquiry', async (req, res) => {
    try {
        const { name, businessName, websiteUrl, email, phone, address, businessType } = req.body;

        if (!name || !businessName || !email || !phone || !address || !businessType) {
            req.flash('errors', 'Please fill in all required fields.');
            return res.redirect('/distributor-inquiry');
        }

        const inquiry = {
            name,
            businessName,
            websiteUrl,
            email,
            phone,
            address,
            businessType,
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        await db.collection('distributor_inquiries').add(inquiry);

        // 🔹 Create Notification for Admin
        try {
            const adminSnapshot = await db.collection('admin_users').get();
            const notificationTitle = 'New Distributor Inquiry';
            const notificationMessage = `New inquiry from ${businessName} (${name}).`;

            for (const adminDoc of adminSnapshot.docs) {
                const adminData = adminDoc.data();
                const notifyTo = adminData.id; // Send to admin email

                // Save to notifications collection
                const notificationRef = db.collection('notifications').doc();
                await notificationRef.set({
                    id: notificationRef.id,
                    title: notificationTitle,
                    message: notificationMessage,
                    notifyTo: notifyTo,
                    type: 'distributor_inquiry',
                    createdAt: new Date().toISOString(),
                    readBy: []
                });

                // Send Push Notification if tokens exist
                // if (Array.isArray(adminData.fcmTokens) && adminData.fcmTokens.length > 0) {
                //     const { sendPushNotification } = require('../services/fcmService');
                //     for (const token of adminData.fcmTokens) {
                //         if (token) {
                //             await sendPushNotification(token, notificationTitle, notificationMessage, {
                //                 type: 'distributor_inquiry',
                //                 inquiryId: inquiry.email // Using email as a ref for now
                //             });
                //         }
                //     }
                // }
            }
        } catch (notifError) {
            console.error('Error creating admin notification for inquiry:', notifError);
            // Non-blocking error
        }

        req.flash('success', 'Thank you! Your inquiry has been received. Our team will contact you soon.');
        res.redirect('/distributor-inquiry');
    } catch (error) {
        console.error('Distributor inquiry error:', error);
        req.flash('errors', 'Something went wrong. Please try again later.');
        res.redirect('/distributor-inquiry');
    }
});

// Handle Affiliate Inquiry Submission
router.post('/affiliate-inquiry', async (req, res) => {
    try {
        const { name, email, websiteUrl, platformType, audienceSize } = req.body;

        if (!name || !email || !websiteUrl || !platformType) {
            req.flash('errors', 'Please fill in all required fields.');
            return res.redirect('/affiliate-inquiry');
        }

        const inquiry = {
            name,
            email,
            websiteUrl,
            platformType,
            audienceSize: audienceSize || 'Not specified',
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        await db.collection('affiliate_inquiries').add(inquiry);

        // 🔹 Create Notification for Admin
        try {
            const adminSnapshot = await db.collection('admin_users').get();
            const notificationTitle = 'New Affiliate Inquiry';
            const notificationMessage = `New affiliate inquiry from ${name} (${platformType}).`;

            for (const adminDoc of adminSnapshot.docs) {
                const adminData = adminDoc.data();
                const notifyTo = adminData.id;

                const notificationRef = db.collection('notifications').doc();
                await notificationRef.set({
                    id: notificationRef.id,
                    title: notificationTitle,
                    message: notificationMessage,
                    notifyTo: notifyTo,
                    type: 'affiliate_inquiry',
                    createdAt: new Date().toISOString(),
                    readBy: []
                });
            }
        } catch (notifError) {
            console.error('Error creating admin notification for affiliate inquiry:', notifError);
        }

        req.flash('success', 'Thank you! Your affiliate application has been received. Our team will review it soon.');
        res.redirect('/affiliate-inquiry');
    } catch (error) {
        console.error('Affiliate inquiry error:', error);
        req.flash('errors', 'Something went wrong. Please try again later.');
        res.redirect('/affiliate-inquiry');
    }
});

// Order Success Page
router.get('/order-success', async (req, res) => {
    try {
        const { orderId } = req.query;
        if (!orderId) return res.redirect('/shop');

        const orderDoc = await db.collection('orders').doc(orderId).get();
        
        if (!orderDoc.exists) {
            // Order hasn't synced from ShipStation yet, show generic success
            return res.render('website/order-success', { 
                title: 'Order Confirmed - RD Fresh',
                order: { 
                    orderId: orderId,
                    status: 'processing',
                    createdAt: new Date().toISOString(),
                    items: [],
                    subtotal: 0,
                    tax: 0,
                    total: 0,
                    email: 'your registered email'
                },
                notSyncedYet: true
            });
        }

        const orderData = orderDoc.data();
        // Add orderId to data for the view
        orderData.orderId = orderId;

        res.render('website/order-success', { 
            title: 'Order Confirmed - RD Fresh',
            order: orderData
        });
    } catch (error) {
        console.error('Order success page error:', error);
        res.redirect('/shop');
    }
});

// Middleware to prevent logged-in users from visiting login/signup
const redirectIfAuthenticated = (req, res, next) => {
    if (res.locals.user && res.locals.user.role !== 'admin') {
        return res.redirect('/resources');
    }
    next();
};

// Customer Portal Auth (Login/Signup)
router.get('/login', redirectIfAuthenticated, (req, res) => {
    if (req.query.restricted === 'resources') {
        req.flash('errors', 'For accessing the resources please login first.');
    }
    res.render('website/login', { title: 'Login - RD Fresh Customer Portal' });
});

router.get('/signup', redirectIfAuthenticated, (req, res) => {
    res.render('website/signup', { title: 'Sign Up - RD Fresh Customer Portal' });
});

router.get('/register', redirectIfAuthenticated, (req, res) => {
    res.render('website/signup', { title: 'Register - RD Fresh Customer Portal' });
});

// Logout Route
router.get('/logout', (req, res) => {
    res.clearCookie('token');
    req.flash('success', 'Logged out successfully.');
    res.redirect('/');
});

// Functionality: Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            req.flash('errors', 'Email and password are required.');
            return res.redirect('/login');
        }

        const userSnapshot = await db.collection('users').where('email', '==', email).limit(1).get();
        
        if (userSnapshot.empty) {
            req.flash('errors', 'Invalid email or password.');
            return res.redirect('/login');
        }

        const userDoc = userSnapshot.docs[0];
        const user = userDoc.data();

        // 🔹 STRICT ROLE CHECK: Only allow customers
        if (user.role !== 'customer') {
            req.flash('errors', 'Record not found.');
            return res.redirect('/login');
        }

        // Compare password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            req.flash('errors', 'Invalid email or password.');
            return res.redirect('/login');
        }

        // Generate JWT
        const settings = await getSettings();
        const secretKey = settings.JWT_SECRET || process.env.JWT_SECRET;

        const token = jwt.sign(
            { id: userDoc.id, name: user.name, email: user.email, role: 'customer' },
            secretKey,
            { expiresIn: '7d' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            secure: true,
            sameSite:"None",
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        req.flash('success', `Welcome back, ${user.name}!`);
        res.redirect('/resources'); // Redirect to resources page
    } catch (error) {
        console.error('Login error:', error);
        req.flash('errors', 'Something went wrong during login.');
        res.redirect('/login');
    }
});

// Distributor Portal Login Page
router.get('/distributor/login', redirectIfAuthenticated, (req, res) => {
    res.redirect('/login?tab=distributor');
});

// Affiliate Portal Login Page
router.get('/affiliate/login', redirectIfAuthenticated, (req, res) => {
    res.redirect('/login?tab=affiliate');
});

// Distributor NDA Page
router.get('/distributor/nda', (req, res) => {
    if (!res.locals.user || res.locals.user.role !== 'distributor') {
        return res.redirect('/login?tab=distributor');
    }
    
    if (res.locals.user.ndaAccepted) {
        return res.redirect('/');
    }

    res.render('website/distributor-nda', {
        title: 'NDA Required - RD Fresh',
        user: res.locals.user
    });
});

// Handle NDA Acceptance
router.post('/distributor/accept-nda', async (req, res) => {
    try {
        if (!res.locals.user || res.locals.user.role !== 'distributor') {
            return res.redirect('/login?tab=distributor');
        }

        const { ndaConsent } = req.body;
        if (!ndaConsent) {
            req.flash('errors', 'You must accept the NDA to proceed.');
            return res.redirect('/distributor/nda');
        }

        const userId = res.locals.user.id;
        
        // 1. Update Firestore
        await db.collection('users').doc(userId).update({
            ndaAccepted: true,
            ndaAcceptedAt: new Date().toISOString()
        });

        // 2. Re-sign JWT to include ndaAccepted: true
        const settings = await getSettings();
        const secretKey = settings.JWT_SECRET || process.env.JWT_SECRET;

        const { iat, exp, ...userPayload } = res.locals.user;
        const newToken = jwt.sign(
            { 
                ...userPayload,
                ndaAccepted: true 
            },
            secretKey,
            { expiresIn: '7d' }
        );

        res.cookie('token', newToken, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        req.flash('success', 'NDA Executed Successfully. Welcome to the network.');
        res.redirect('/');

    } catch (error) {
        console.error('NDA acceptance error:', error);
        req.flash('errors', 'Failed to process agreement.');
        res.redirect('/distributor/nda');
    }
});

// Handle Distributor Login
router.post('/distributor/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            req.flash('errors', 'Email and password are required.');
            return res.redirect('/distributor/login');
        }

        const userSnapshot = await db.collection('users').where('email', '==', email).limit(1).get();
        
        if (userSnapshot.empty) {
            req.flash('errors', 'Invalid credentials.');
            return res.redirect('/login?tab=distributor');
        }

        const userDoc = userSnapshot.docs[0];
        const user = userDoc.data();

        // 🔹 STRICT ROLE CHECK: Only allow distributors
        if (user.role !== 'distributor') {
            req.flash('errors', 'Record not found.');
            return res.redirect('/login?tab=distributor');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            req.flash('errors', 'Invalid credentials.');
            return res.redirect('/login?tab=distributor');
        }

        const settings = await getSettings();
        const secretKey = settings.JWT_SECRET || process.env.JWT_SECRET;

        const token = jwt.sign(
            { 
                id: userDoc.id, 
                name: user.name, 
                email: user.email, 
                role: 'distributor',
                ndaAccepted: user.ndaAccepted || false 
            },
            secretKey,
            { expiresIn: '7d' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        req.flash('success', `Welcome to the Command Center, ${user.name}!`);
        
        // Immediate check for redirection
        if (!user.ndaAccepted) {
            return res.redirect('/distributor/nda');
        }
        
        res.redirect('/'); 
    } catch (error) {
        console.error('Distributor login error:', error);
        req.flash('errors', 'Something went wrong during authentication.');
        return res.redirect('/login?tab=distributor');
    }
});

// Handle Affiliate Login
router.post('/affiliate/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            req.flash('errors', 'Email and password are required.');
            return res.redirect('/affiliate/login');
        }

        const userSnapshot = await db.collection('users').where('email', '==', email).limit(1).get();
        
        if (userSnapshot.empty) {
            req.flash('errors', 'Invalid credentials.');
            return res.redirect('/login?tab=affiliate');
        }

        const userDoc = userSnapshot.docs[0];
        const user = userDoc.data();

        // 🔹 STRICT ROLE CHECK: Only allow affiliates
        if (user.role !== 'affiliate') {
            req.flash('errors', 'Record not found.');
            return res.redirect('/login?tab=affiliate');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            req.flash('errors', 'Invalid credentials.');
            return res.redirect('/login?tab=affiliate');
        }

        const settings = await getSettings();
        const secretKey = settings.JWT_SECRET || process.env.JWT_SECRET;

        const token = jwt.sign(
            { 
                id: userDoc.id, 
                name: user.name, 
                email: user.email, 
                role: 'affiliate'
            },
            secretKey,
            { expiresIn: '7d' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        req.flash('success', `Welcome back, ${user.name}!`);
        res.redirect('/resources'); // For now redirecting to resources

    } catch (error) {
        console.error('Affiliate login error:', error);
        req.flash('errors', 'Something went wrong during login.');
        res.redirect('/login?tab=affiliate');
    }
});

// Functionality: Signup
router.post('/signup', async (req, res) => {
    try {
        const { name, email, password, company } = req.body;

        if (!name || !email || !password) {
            req.flash('errors', 'Please fill in all required fields.');
            return res.redirect('/signup');
        }

        // Check if user already exists
        const userSnapshot = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!userSnapshot.empty) {
            req.flash('errors', 'Email is already registered. Please login.');
            return res.redirect('/signup');
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Save user
        const newUser = {
            name,
            email,
            password: hashedPassword,
            company: company || '',
            role: 'customer',
            status: 'pending', // Facility might need manual approval later
            createdAt: new Date().toISOString()
        };

        const docRef = await db.collection('users').add(newUser);

        // Auto-login after signup
        const token = jwt.sign(
            { id: docRef.id, name: newUser.name, email: newUser.email, role: 'customer' },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        req.flash('success', 'Account created successfully! Welcome to RD Fresh.');
        res.redirect('/resources');
    } catch (error) {
        console.error('Signup error:', error);
        req.flash('errors', 'Something went wrong during registration.');
        res.redirect('/signup');
    }
});

// Functionality: Subscribe to Newsletter
router.post('/subscribe', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
        }

        // Check if already subscribed (optional but good practice)
        const subSnapshot = await db.collection('subscriptions').where('email', '==', email).limit(1).get();
        if (!subSnapshot.empty) {
            return res.status(200).json({ success: true, message: 'You are already subscribed!' });
        }

        // Save to subscriptions collection
        await db.collection('subscriptions').add({
            email,
            subscribedAt: new Date().toISOString(),
            source: 'website_popup'
        });

        res.status(200).json({ success: true, message: 'Thank you for subscribing!' });
    } catch (error) {
        console.error('Subscription error:', error);
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again later.' });
    }
});

// Privacy Policy Page
router.get('/privacy-policy', (req, res) => {
    res.render('website/privacy-policy', { title: 'Privacy Policy - RD Fresh' });
});

// Terms of Service Page
router.get('/terms', (req, res) => {
    res.render('website/terms', { title: 'Terms of Service - RD Fresh' });
});

// Refund Policy Page
router.get('/refund-policy', (req, res) => {
    res.render('website/refund-policy', { title: 'Refund Policy - RD Fresh' });
});

module.exports = router;

