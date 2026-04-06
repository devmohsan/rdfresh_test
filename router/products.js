const { db, storage } = require('../firebase/db');
const authentication = require('../middleware/auth');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { getSettings } = require('../services/settingsService');
const express = require('express');
const router = express.Router();

async function syncProductToShipStation(productData, productId = null) {
    const settings = await getSettings();
    const API_KEY = settings.API_KEY || process.env.API_KEY;
    const API_SK = settings.API_SK || process.env.API_SK;

    const auth = Buffer.from(`${API_KEY}:${API_SK}`).toString('base64');
    
    // ShipStation payload
    const payload = {
        sku: productData.sku,
        name: productData.name,
        price: parseFloat(productData.price || 0),
        weightOz: parseFloat(productData.weightOz || 0),
        internalNotes: productData.internalNotes || '',
        active: productData.active !== undefined ? productData.active : true,
        imageUrl: productData.imageUrl || null
    };

    // Determine endpoint and method
    const url = productId 
        ? `https://ssapi.shipstation.com/products/${productId}`
        : 'https://ssapi.shipstation.com/products/createproduct';
    const method = productId ? 'PUT' : 'POST';

    if (productId) {
        payload.productId = productId;
    }

    console.log(`📡 ShipStation Sync: ${method} ${url}`);
    console.log(`📦 Payload:`, JSON.stringify(payload, null, 2));
    
    const response = await fetch(url, {
        method: method,
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ShipStation Product ${productId ? 'Update' : 'Create'} Failed: ${errorText}`);
    }

    return await response.json();
}

// List all products
router.get('/', authentication, async (req, res) => {
    try {
        const productsSnapshot = await db.collection('products').get();
        const products = productsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.render('products', {
            admin: req.user,
            products: products,
            currentPath: '/admin/products',
            success_msg: req.flash('success'),
            error_msg: req.flash('errors')
        });
    } catch (error) {
        console.error('Error fetching admin products:', error);
        req.flash('errors', 'Unable to fetch products');
        res.redirect('/admin/dashboard');
    }
});

// GET /add - Render add product form
router.get('/add', authentication, (req, res) => {
    res.render('addproduct', { 
        admin: req.user, 
        product: {}, 
        mode: 'add',
        currentPath: '/admin/products'
    });
});

// POST /add - Create product
router.post('/add', authentication, upload.single('image'), async (req, res) => {
    try {
        const { name, sku, price, weightOz, internalNotes, active } = req.body;
        let imageUrl = '';

        if (req.file) {
            const fileName = `products/${sku}_${Date.now()}`;
            const file = storage.bucket().file(fileName);
            
            await file.save(req.file.buffer, {
                metadata: { contentType: req.file.mimetype }
            });

            // Make public (or get signed URL)
            await file.makePublic();
            imageUrl = `https://storage.googleapis.com/${storage.bucket().name}/${fileName}`;
        }
        
        const productData = { 
            name, 
            sku, 
            price: parseFloat(price) || 0, 
            weightOz: parseFloat(weightOz) || 0, 
            internalNotes, 
            imageUrl, 
            active: active === 'true' 
        };

        // 1. Sync to ShipStation (Always POST for new products)
        const ssResult = await syncProductToShipStation(productData);
        
        // 2. Save to Firestore (use ShipStation's productId if returned)
        const productId = ssResult.productId.toString();
        await db.collection('products').doc(productId).set({
            ...productData,
            productId: productId,
            lastSyncAt: new Date().toISOString()
        });

        req.flash('success', 'Product created and synced to ShipStation');
        res.redirect('/admin/products');
    } catch (error) {
        console.error('Error adding product:', error);
        req.flash('errors', `Failed to add product: ${error.message}`);
        res.redirect('/admin/products/add');
    }
});

// GET /edit/:id - Render edit product form
router.get('/edit/:id', authentication, async (req, res) => {
    try {
        const productDoc = await db.collection('products').doc(req.params.id).get();
        if (!productDoc.exists) {
            req.flash('errors', 'Product not found');
            return res.redirect('/admin/products');
        }

        res.render('addproduct', { 
            admin: req.user, 
            product: { id: productDoc.id, ...productDoc.data() }, 
            mode: 'edit',
            currentPath: '/admin/products'
        });
    } catch (error) {
        console.error('Error loading product for edit:', error);
        req.flash('errors', 'Unable to load product');
        res.redirect('/admin/products');
    }
});

// POST /edit/:id - Update product
router.post('/edit/:id', authentication, upload.single('image'), async (req, res) => {
    try {
        const productId = req.params.id;
        const { name, sku, price, weightOz, internalNotes, active } = req.body;
        
        // Fetch existing to get current image if no new one
        const productDoc = await db.collection('products').doc(productId).get();
        let imageUrl = productDoc.exists ? productDoc.data().imageUrl : '';

        if (req.file) {
            const fileName = `products/${sku}_${Date.now()}`;
            const file = storage.bucket().file(fileName);
            
            await file.save(req.file.buffer, {
                metadata: { contentType: req.file.mimetype }
            });

            await file.makePublic();
            imageUrl = `https://storage.googleapis.com/${storage.bucket().name}/${fileName}`;
        }
        
        const productData = { 
            name, 
            sku, 
            price: parseFloat(price) || 0, 
            weightOz: parseFloat(weightOz) || 0, 
            internalNotes, 
            imageUrl, 
            active: active === 'true' 
        };

        // 1. Sync to ShipStation (Always PUT for edits)
        await syncProductToShipStation(productData, productId);
        
        // 2. Update in Firestore
        await db.collection('products').doc(productId).update({
            ...productData,
            lastSyncAt: new Date().toISOString()
        });

        req.flash('success', 'Product updated and synced to ShipStation');
        res.redirect('/admin/products');
    } catch (error) {
        console.error('Error updating product:', error);
        req.flash('errors', `Failed to update product: ${error.message}`);
        res.redirect(`/admin/products/edit/${req.params.id}`);
    }
});

// Toggle product status (active/inactive)
router.post('/toggle-status/:id', authentication, async (req, res) => {
    try {
        const productId = req.params.id;
        const productRef = db.collection('products').doc(productId);
        const doc = await productRef.get();
        
        if (!doc.exists) {
            req.flash('errors', 'Product not found');
            return res.redirect('/admin/products');
        }

        const currentStatus = doc.data().active;
        await productRef.update({ active: !currentStatus });

        req.flash('success', `Product ${!currentStatus ? 'activated' : 'deactivated'} successfully`);
        res.redirect('/admin/products');
    } catch (error) {
        console.error('Error toggling product status:', error);
        req.flash('errors', 'Failed to update product status');
        res.redirect('/admin/products');
    }
});

module.exports = router;
