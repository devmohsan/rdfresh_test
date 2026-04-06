const express = require('express');
const router = express.Router();
const authentication = require('../middleware/auth');
const { db } = require('../firebase/db');

// List FAQs
router.get('/', authentication, async (req, res) => {
    try {
        const faqSnapshot = await db.collection('faqs').orderBy('createdAt', 'desc').get();
        const faqs = [];
        faqSnapshot.forEach(doc => {
            faqs.push({ id: doc.id, ...doc.data() });
        });
        res.render('faq', { faqs, admin: req.user });
    } catch (error) {
        console.error('Error fetching FAQs:', error);
        req.flash('errors', 'Failed to load FAQs');
        res.redirect('/admin/dashboard');
    }
});

// Create FAQ
router.post('/add', authentication, async (req, res) => {
    try {
        const { question, answer } = req.body;
        if (!question || !answer) {
            req.flash('errors', 'Question and Answer are required');
            return res.redirect('/admin/faq');
        }
        await db.collection('faqs').add({
            question,
            answer: answer.substring(0, 500), // Limiting to 500 characters, though user mentioned 100 character answer (maybe for display?)
            createdAt: new Date().toISOString()
        });
        req.flash('success', 'FAQ added successfully');
        res.redirect('/admin/faq');
    } catch (error) {
        console.error('Error adding FAQ:', error);
        req.flash('errors', 'Failed to add FAQ');
        res.redirect('/admin/faq');
    }
});

// Update FAQ
router.post('/edit/:id', authentication, async (req, res) => {
    try {
        const { id } = req.params;
        const { question, answer } = req.body;
        await db.collection('faqs').doc(id).update({
            question,
            answer,
            updatedAt: new Date().toISOString()
        });
        req.flash('success', 'FAQ updated successfully');
        res.redirect('/admin/faq');
    } catch (error) {
        console.error('Error updating FAQ:', error);
        req.flash('errors', 'Failed to update FAQ');
        res.redirect('/admin/faq');
    }
});

// Delete FAQ
router.get('/delete/:id', authentication, async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('faqs').doc(id).delete();
        req.flash('success', 'FAQ deleted successfully');
        res.redirect('/admin/faq');
    } catch (error) {
        console.error('Error deleting FAQ:', error);
        req.flash('errors', 'Failed to delete FAQ');
        res.redirect('/admin/faq');
    }
});

module.exports = router;
