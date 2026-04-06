const express = require('express');

const router = express.Router();
const bcrypt = require('bcrypt');

const { db } = require('../firebase/db');
const crypto = require('crypto');
const { sendCredentials } = require('../services/mailService');


const authentication = require('../middleware/auth');

// Inquiries List (Distributor & Affiliate)
router.get('/inquiries', authentication, async (req, res) => {
    try {
        const distributorSnapshot = await db.collection('distributor_inquiries').orderBy('createdAt', 'desc').get();
        const inquiries = distributorSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), type: 'distributor' }));

        const affiliateSnapshot = await db.collection('affiliate_inquiries').orderBy('createdAt', 'desc').get();
        const affiliates = affiliateSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), type: 'affiliate' }));
        
        const adminUser = res.locals.admin;

        res.render('inquiries', { 
            inquiries,
            affiliates,
            admin: adminUser,
            success_msg: req.flash('success'),
            error_msg: req.flash('errors')
        });
    } catch (error) {
        console.error('Error fetching inquiries:', error);
        req.flash('errors', 'Failed to load inquiries.');
        res.redirect('/admin/dashboard');
    }
});

// View Specific Inquiry
router.get('/inquiries/view/:id', authentication, async (req, res) => {
    try {
        const { type } = req.query; // 'distributor' or 'affiliate'
        const collectionName = type === 'affiliate' ? 'affiliate_inquiries' : 'distributor_inquiries';
        
        const doc = await db.collection(collectionName).doc(req.params.id).get();
        if (!doc.exists) {
            req.flash('errors', 'Inquiry not found.');
            return res.redirect('/admin/inquiries');
        }

        const inquiry = { id: doc.id, ...doc.data(), type: type || 'distributor' };
        res.render('view-inquiry', { 
            inquiry,
            admin: res.locals.admin,
            success_msg: req.flash('success'),
            error_msg: req.flash('errors')
        });
    } catch (error) {
        console.error('Error viewing inquiry:', error);
        req.flash('errors', 'Failed to load inquiry details.');
        res.redirect('/admin/inquiries');
    }
});

// Approve Inquiry
router.post('/inquiries/approve/:id', authentication, async (req, res) => {
    try {
        const inquiryId = req.params.id;
        const { type } = req.query; // 'distributor' or 'affiliate'
        const collectionName = type === 'affiliate' ? 'affiliate_inquiries' : 'distributor_inquiries';
        const role = type === 'affiliate' ? 'affiliate' : 'distributor';

        const inquiryRef = db.collection(collectionName).doc(inquiryId);
        const inquiryDoc = await inquiryRef.get();

        if (!inquiryDoc.exists) {
            req.flash('errors', 'Inquiry not found.');
            return res.redirect('/admin/inquiries');
        }

        const inquiryData = inquiryDoc.data();
        
        // Check if user already exists with this email
        const userExists = await db.collection('users').where('email', '==', inquiryData.email).limit(1).get();
        if (!userExists.empty) {
            req.flash('errors', 'A user with this email already exists.');
            return res.redirect('/admin/inquiries');
        }

        // 1. Generate Random Password
        const tempPassword = crypto.randomBytes(5).toString('hex'); // 10 chars
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        // 2. Create User in 'users' collection
        const newUser = {
            name: inquiryData.name,
            email: inquiryData.email,
            password: hashedPassword,
            businessName: inquiryData.businessName || '',
            address: inquiryData.address || '',
            phone: inquiryData.phone || '',
            role: role,
            status: 'active',
            ndaAccepted: false,
            createdAt: new Date().toISOString()
        };

        // Add affiliate specific fields if any
        if (type === 'affiliate') {
            newUser.platformType = inquiryData.platformType || '';
            newUser.audienceSize = inquiryData.audienceSize || '';
            newUser.websiteUrl = inquiryData.websiteUrl || '';
        }

        const userRef = await db.collection('users').add(newUser);
        await userRef.update({ id: userRef.id });

        // 3. Update Inquiry Status
        await inquiryRef.update({ 
            status: 'approved',
            userId: userRef.id,
            approvedAt: new Date().toISOString()
        });

        // 4. Send Email Credentials
        try {
            await sendCredentials(inquiryData.email, inquiryData.name, tempPassword);
        } catch (mailError) {
            console.error('Email sending failed:', mailError);
            req.flash('errors', 'User created but email failed to send. Password: ' + tempPassword);
            return res.redirect('/admin/inquiries');
        }

        req.flash('success', `${type === 'affiliate' ? 'Affiliate' : 'Distributor'} inquiry approved and account created.`);
        res.redirect('/admin/inquiries');
    } catch (error) {
        console.error('Error approving inquiry:', error);
        req.flash('errors', 'Failed to approve inquiry.');
        res.redirect('/admin/inquiries');
    }
});

// Delete/Reject Inquiry
router.post('/inquiries/delete/:id', authentication, async (req, res) => {
    try {
        const { type } = req.query; // 'distributor' or 'affiliate'
        const collectionName = type === 'affiliate' ? 'affiliate_inquiries' : 'distributor_inquiries';
        
        await db.collection(collectionName).doc(req.params.id).delete();
        req.flash('success', 'Inquiry removed from records.');
        res.redirect('/admin/inquiries');
    } catch (error) {
        console.error('Error deleting inquiry:', error);
        req.flash('errors', 'Failed to delete inquiry.');
        res.redirect('/admin/inquiries');
    }
});
router.get('/create-admin', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash('123456789', 10);

        const docRef = await db.collection('admin_user').add({
            email: 'admin@admin.com',
            password: hashedPassword,
            name: 'Super admin'
        });

        // After adding, update the document with its ID as a field
        await docRef.update({ id: docRef.id });

        res.send({
            message: '✅ Admin user created successfully',
            id: docRef.id
        });
    } catch (error) {
        console.error('❌ Error creating admin:', error);
        res.status(500).send({ error: error.message });
    }
});
module.exports = router;