const express = require('express');
const router = express.Router();
const {db} = require('../firebase/db');
const authentication = require('../middleware/auth');
const bcrypt = require('bcrypt');


router.get('/', authentication, async (req, res) => {
  try {
    const currentUser = req.user;
    const snapshot = await db.collection('users').get();
    
    // Fetch users and their unsigned delivered orders count
    const users = await Promise.all(snapshot.docs.map(async (doc) => {
      const userData = doc.data();
      const userId = doc.id;
      
      // Query unsigned delivered orders for this user's email
      const unsignedOrdersSnapshot = await db.collection('orders')
        .where('customerEmail', '==', userData.email)
        .where('status', '==', 'delivered')
        .where('signatureStatus', '==', 'unsigned')
        .get();
        
      return { 
        id: userId, 
        ...userData, 
        unsignedCount: unsignedOrdersSnapshot.size,
        unsignedOrders: unsignedOrdersSnapshot.docs.map(o => ({ id: o.id, ...o.data() }))
      };
    }));
    
    res.render('users', { 
      users,
      query: req.query,
      success_msg: req.flash('success'), 
      error_msg: req.flash('errors'),
      admin: currentUser
    });
  } catch (err) {
    console.error('Error fetching users:', err);
    req.flash('errors', 'Error fetching users: ' + err.message);
    res.redirect('/admin/dashboard');
  }
});

router.post('/approve/:id', authentication, async (req, res) => {
  try {
    await db.collection('users').doc(req.params.id).update({ status: 'approved' });
    req.flash('success', 'User approved');
    res.redirect('/admin/users');
  } catch (err) {
    req.flash('errors', 'Approval failed');
    res.redirect('/admin/users');
  }
});

router.post('/suspend/:id', authentication, async (req, res) => {
  try {
    await db.collection('users').doc(req.params.id).update({ status: 'suspended' });
    req.flash('success', 'User suspended');
    res.redirect('/admin/users');
  } catch (err) {
    req.flash('errors', 'Suspension failed');
    res.redirect('/admin/users');
  }
});



router.post('/delete/:id', authentication, async (req, res) => {
  try {
    await db.collection('users').doc(req.params.id).delete();
    req.flash('success', 'User deleted');
    res.redirect('/admin/users');
  } catch (err) {
    req.flash('errors', 'Delete failed');
    res.redirect('/admin/users');
  }
});


// router.get('/view/:id', authentication, async (req, res) => {
//   try {
//     const doc = await db.collection('users').doc(req.params.id).get();
//     if (!doc.exists) throw new Error('User not found');
//     const user = doc.data();
//     res.render('viewUser', { user });
//   } catch (err) {
//     console.error('Error viewing user:', err.message);
//     req.flash('errors', 'Unable to view user');
//     res.redirect('/users');
//   }
// });

router.get('/view/:id', authentication, async (req, res) => {
  try {
    // Step 1: Fetch the user data from `users` collection
    const userRef = db.collection('users').doc(req.params.id);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const user = userDoc.data();

    // Step 2: Fetch all purchased packs from `purchases_packs` collection for this user
    const purchasedSnapshot = await db.collection('purchased_packs')
      .where('userId', '==', req.params.id)
      .get();

    const purchasedPacks = [];
    purchasedSnapshot.forEach(doc => {
      purchasedPacks.push({ id: doc.id, ...doc.data() });
    });

    
    // Step 3: Render the EJS view with both user and purchased packs
    // res.send.json({ user, purchasedPacks });
    res.render('viewUser', {
      user,
      purchasedPacks
    });

  } catch (err) {
    console.error('Error viewing user and packs:', err.message);
    req.flash('errors', 'Unable to load user or purchased packs');
    res.redirect('/admin/users');
  }
});

// GET /add - Render add user form
router.get('/add', authentication, (req, res) => {
  res.render('addUser', { admin: req.user });
});

// POST /add - Create new user
router.post('/add', authentication, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      req.flash('errors', 'Name, email, and password are required');
      return res.redirect('/admin/users/add');
    }

    // Check if user already exists
    const existingUser = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!existingUser.empty) {
      req.flash('errors', 'User with this email already exists');
      return res.redirect('/admin/users/add');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userData = {
      name,
      email,
      password: hashedPassword,
      role: role || 'user',
      status: 'approved', // Default to approved
      createdAt: new Date().toISOString()
    };

    await db.collection('users').add(userData);

    req.flash('success', 'User created successfully');
    res.redirect('/admin/users');
  } catch (err) {
    console.error('Error creating user:', err);
    req.flash('errors', 'Failed to create user');
    res.redirect('/admin/users/add');
  }
});

module.exports = router;