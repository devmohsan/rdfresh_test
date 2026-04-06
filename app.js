require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const cookieParser = require("cookie-parser"); 

const bodyParser = require('body-parser');
const adminRoutes = require('./router/admin');
const loginRoutes = require('./router/login');
const indexRoutes = require('./router/index');
const userRoutes= require('./router/users');
const orders= require('./router/orders');
const faqRoutes = require('./router/faq');
const notificationRoutes = require('./router/notifications');
const websiteRoutes = require('./router/website');
const cartRoutes = require('./router/cart');
const productRoutes = require('./router/products');
const { startSyncJob } = require('./services/syncService');

const app = express();

app.use(cookieParser());
app.use(
    session({
        secret: 'techie members', // use env variable in real projects
        resave: false,
        saveUninitialized: false,
        proxy: true,
        cookie: { secure: false,
        sameSite: "lax"}, // set secure: true in HTTPS environments
    })
);


app.set("trust proxy", 1);

app.use(flash())

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


const jwt = require('jsonwebtoken'); // Ensure jwt is available
const { getSettings } = require('./services/settingsService');
app.use(async (req, res, next) => {
    const token = req.cookies?.token;
    res.locals.user = null;

    if (token) {
        try {
            const settings = await getSettings();
            const secretKey = settings.JWT_SECRET || process.env.JWT_SECRET;
            const decoded = jwt.verify(token, secretKey);
            res.locals.user = decoded;
        } catch (err) {
            // Invalid token, just clear it or ignore
        }
    }

    //teset

    res.locals.success_msg = req.flash('success');
    res.locals.error_msg = req.flash('errors');
    res.locals.currentPath = req.path;
    next();
});

// app.use(express.static(path.join(__dirname, 'public')));

// --- WEBSITE ROUTES (Public) ---
app.use('/', websiteRoutes);
app.use('/cart', cartRoutes);

// --- ADMIN ROUTES (Protected/Namespaced) ---
app.use('/admin', adminRoutes);
app.use('/admin', loginRoutes);
app.use('/admin', indexRoutes);
app.use('/admin/users', userRoutes);
app.use('/admin/orders', orders);
app.use('/admin/faq', faqRoutes);
app.use('/admin/products', productRoutes);

// API Routes
app.use('/api/notifications', notificationRoutes);

// QuickBooks Routes
const quickbooksRoutes = require('./router/quickbooks');
app.use('/quickbooks', quickbooksRoutes);


app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.set('etag', false);
const PORT = process.env.PORT || 3001;
app.listen(PORT,'0.0.0.0', () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`🚀 Admin panel at http://localhost:${PORT}/admin`);
    startSyncJob();
});
