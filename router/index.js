const express = require('express');
const router = express.Router();
const authentication = require('../middleware/auth');
const multer = require('multer');
const csv = require('csv-parser');
const stream = require('stream');
const fs = require('fs');
const { db, storage } = require('../firebase/db');
const dayjs = require('dayjs');
const crypto = require('crypto');





function decryptFirst32Bytes(encryptedTextWithIV) {
  try {
    // 1. Split into ciphertext and IV parts
    const [ciphertextBase64, ivBase64] = encryptedTextWithIV.split(':');
    
    // 2. Decode from Base64
    const ciphertext = Buffer.from(ciphertextBase64, 'base64');
    const iv = Buffer.from(ivBase64, 'base64');
    
    // 3. Get first 32 bytes of ciphertext (2 AES blocks)
    const first32Bytes = ciphertext.subarray(0, 32);
    
    // 4. Verify we have enough data
    if (first32Bytes.length < 32) {
      throw new Error('Ciphertext too short - need at least 32 bytes');
    }
    
    // 5. Prepare key (must match Flutter exactly)
    const key = Buffer.from('my 32 length key................'); // 32 bytes
    
    // 6. Create decipher
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    
    // 7. Decrypt just the first 32 bytes (2 blocks)
    let decrypted = decipher.update(first32Bytes);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    // 8. Remove PKCS7 padding if present
    const padLength = decrypted[decrypted.length - 1];
    if (padLength > 0 && padLength <= 16) {
      decrypted = decrypted.slice(0, -padLength);
    }
    
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('Decryption failed:', {
      error: error.message,
      input: encryptedTextWithIV.substring(0, 30) + '...'
    });
    return null;
  }
}


function decryptAES(encryptedTextWithIV) {
  try {
    // 1. Verify input format
    if (!encryptedTextWithIV.includes(':')) {
      throw new Error('Invalid format - missing IV separator');
    }

    // 2. Extract components
    const [encryptedBase64, ivBase64] = encryptedTextWithIV.split(':');
    if (!encryptedBase64 || !ivBase64) {
      throw new Error('Missing encrypted data or IV');
    }

    // 3. Prepare key (MUST match Flutter key exactly)
    const key = Buffer.from('my 32 length key................'); // 32 bytes
    
    // 4. Decode from Base64
    const iv = Buffer.from(ivBase64, 'base64');
    const encrypted = Buffer.from(encryptedBase64, 'base64');

    // 5. Verify lengths
    console.log(`IV length: ${iv.length} bytes (must be 16)`);
    console.log(`Encrypted length: ${encrypted.length} bytes (must be multiple of 16)`);

    if (iv.length !== 16) {
      throw new Error('Invalid IV length - must be 16 bytes');
    }

    if (encrypted.length % 16 !== 0) {
      throw new Error('Invalid ciphertext length - must be multiple of 16');
    }

    // 6. Decrypt with error handling
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    
    // Try both automatic and manual padding
    try {
      // Attempt with automatic padding
      decipher.setAutoPadding(true);
      let decrypted = decipher.update(encrypted, null, 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (autoPadError) {
      console.log('Auto-padding failed, trying manual padding...');
      
      // Fallback to manual padding
      decipher.setAutoPadding(false);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      // Remove PKCS#7 padding manually
      const padLength = decrypted[decrypted.length - 1];
      if (padLength > 0 && padLength <= 16) {
        decrypted = decrypted.slice(0, -padLength);
      }
      
      return decrypted.toString('utf8');
    }
  } catch (error) {
    console.error('Decryption failed:', {
      error: error.message,
      inputLength: encryptedTextWithIV.length,
      ivPart: encryptedTextWithIV.split(':')[1]?.length
    });
    return null;
  }
}

const upload = multer({ storage: multer.memoryStorage() });


// router.get('/dashboard', authentication, async (req, res) => {

//     return res.render('dashboard');

// })

router.get('/dashboard', authentication, async (req, res) => {
    try {
        const user = req.user;
        const currentDate = new Date();
        const todayStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
        const todayEnd = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1);
        
        let dashboardData = {
            totalOrders: 0,
            pendingOrders: 0,
            completedOrders: 0,
            totalRevenue: 0,
            todayOrders: 0,
            totalUsers: 0,
            approvedUsers: 0,
            pendingUsers: 0,
            recentOrders: [],
            recentUsers: [],
        };

        // For Admin Users: Get all system data
        
        // Get all orders
        const ordersSnapshot = await db.collection('orders').get();
        dashboardData.totalOrders = ordersSnapshot.size;
        
        // Calculate order stats
        let totalRevenue = 0;
        let pendingOrders = 0;
        let completedOrders = 0;
        let todayOrders = 0;
        
        ordersSnapshot.forEach(doc => {
            const order = doc.data();
            totalRevenue += parseFloat(order.total_amount || 0);
            
            if (order.status === 'pending') pendingOrders++;
            if (order.status === 'completed') completedOrders++;
            
            // Check if order is from today
            const orderDate = order.createdAt || order.date;
            if (orderDate && 
                orderDate.toDate && 
                orderDate.toDate() >= todayStart && 
                orderDate.toDate() < todayEnd) {
                todayOrders++;
            }
        });
        
        dashboardData.totalRevenue = totalRevenue.toFixed(2);
        dashboardData.pendingOrders = pendingOrders;
        dashboardData.completedOrders = completedOrders;
        dashboardData.todayOrders = todayOrders;
        
        // Get all users
        const usersSnapshot = await db.collection('users').get();
        dashboardData.totalUsers = usersSnapshot.size;
        
        let approvedUsers = 0;
        let pendingUsers = 0;
        usersSnapshot.forEach(doc => {
            const userData = doc.data();
            if (userData.status === 'approved') approvedUsers++;
            if (userData.status === 'pending') pendingUsers++;
        });
        
        dashboardData.approvedUsers = approvedUsers;
        dashboardData.pendingUsers = pendingUsers;
        
        // Get recent orders (last 5)
        const recentOrdersQuery = db.collection('orders')
            .orderBy('createdAt', 'desc')
            .limit(5);
        
        const recentOrdersSnapshot = await recentOrdersQuery.get();
        dashboardData.recentOrders = recentOrdersSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        // Get recent users (last 5)
        const recentUsersQuery = db.collection('users')
            .orderBy('createdAt', 'desc')
            .limit(5);
        
        const recentUsersSnapshot = await recentUsersQuery.get();
        dashboardData.recentUsers = recentUsersSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // 🔹 Fallback Dummy Data for Demonstration
        if (dashboardData.totalOrders === 0) {
            dashboardData.totalOrders = 124;
            dashboardData.pendingOrders = 12;
            dashboardData.completedOrders = 112;
            dashboardData.totalRevenue = "2,450.00";
            dashboardData.todayOrders = 8;
        }

        if (dashboardData.totalUsers === 0) {
            dashboardData.totalUsers = 45;
            dashboardData.approvedUsers = 40;
            dashboardData.pendingUsers = 5;
        }

        if (dashboardData.recentOrders.length === 0) {
            dashboardData.recentOrders = [
                { id: 'ORD00123', status: 'completed', total_amount: '45.00', createdAt: { seconds: Date.now() / 1000 } },
                { id: 'ORD00124', status: 'pending', total_amount: '22.50', createdAt: { seconds: Date.now() / 1000 } },
                { id: 'ORD00125', status: 'completed', total_amount: '120.00', createdAt: { seconds: Date.now() / 1000 } }
            ];
        }

        if (dashboardData.recentUsers.length === 0) {
            dashboardData.recentUsers = [
                { name: 'John Doe', email: 'john@example.com', status: 'approved' },
                { name: 'Sarah Connor', email: 'sarah.c@example.com', status: 'pending' },
                { name: 'Mike Ross', email: 'mike.r@example.com', status: 'approved' }
            ];
        }

        // 🔹 Send to dashboard with all data
        res.render('dashboard', {
            admin: user,
            dashboard: dashboardData,
            success_msg: req.flash('success'),
            error_msg: req.flash('errors')
        });

    } catch (error) {
        console.error('Error loading dashboard:', error);
        req.flash('errors', 'Unable to load dashboard data');
        res.redirect('/admin');
    }
});

module.exports = router;