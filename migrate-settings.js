require('dotenv').config();
const { db } = require('./firebase/db');

async function migrateSettings() {
    console.log('🚀 Starting settings migration...');
    
    const config = {
        JWT_SECRET: process.env.JWT_SECRET,
        MAIL_USER: process.env.MAIL_USER,
        MAIL_PASS: process.env.MAIL_PASS,
        API_KEY: process.env.API_KEY,
        API_SK: process.env.API_SK,
        QB_clientId: process.env.QB_clientId,
        QB_SKId: process.env.QB_SKId,
        QUICKBOOKS_REDIRECT_URI: process.env.QUICKBOOKS_REDIRECT_URI,
        PORT: process.env.PORT || 3000,
        updatedAt: new Date().toISOString()
    };

    try {
        await db.collection('settings').doc('config').set(config, { merge: true });
        console.log('✅ Settings successfully migrated to Firestore (collection: settings, doc: config)');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrateSettings();
