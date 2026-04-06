const jwt = require('jsonwebtoken');
const { getSettings } = require('../services/settingsService');

const auth = async (req, res, next) => {
    const token = req.cookies?.token;

    if (!token) {
        req.flash('errors', 'Unauthorized. Please login first.');
        return res.redirect('/admin');
    }

    try {
        const settings = await getSettings();
        const secretKey = settings.JWT_SECRET || process.env.JWT_SECRET;
        
        const decoded = jwt.verify(token, secretKey);
        req.user = decoded;
        res.locals.admin= decoded;
        next();
    } catch (err) {
        console.error('Invalid token:', err.message);
        res.clearCookie('token');
        req.flash('errors', 'Session expired. Please login again.');
        return res.redirect('/admin');
    }
};

module.exports = auth;
