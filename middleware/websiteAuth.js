const userAuth = (req, res, next) => {
    if (!res.locals.user || res.locals.user.role === 'admin') {
        if (res.locals.user && res.locals.user.role === 'admin') {
            req.flash('errors', 'Admin sessions are not allowed on the website portal.');
        } else {
            req.flash('errors', 'Please login to access this area.');
        }
        return res.redirect('/login');
    }
    next();
};

const ndaGuard = (req, res, next) => {
    // If not logged in or admin, move to next (auth middleware will handle it later if needed)
    if (!res.locals.user || res.locals.user.role === 'admin') return next();

    // Only apply to distributors
    if (res.locals.user.role === 'distributor') {
        // Exempt the NDA page and the acceptance route to avoid infinite loops
        const allowedPaths = ['/distributor/nda', '/distributor/accept-nda', '/logout'];
        if (allowedPaths.includes(req.path)) {
            return next();
        }

        if (!res.locals.user.ndaAccepted) {
            return res.redirect('/distributor/nda');
        }
    }
    next();
};

module.exports = { userAuth, ndaGuard };
