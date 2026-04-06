const { db } = require('../firebase/db');

let settingsCache = null;

async function getSettings() {
    if (settingsCache) return settingsCache;

    try {
        const settingsDoc = await db.collection('settings').doc('config').get();
        if (settingsDoc.exists) {
            settingsCache = settingsDoc.data();
            return settingsCache;
        } else {
            console.warn('⚠️ No settings found in Firestore/settings/config. Falling back to environment variables.');
            return process.env;
        }
    } catch (error) {
        console.error('❌ Error fetching settings from Firestore:', error);
        return process.env;
    }
}

async function refreshSettings() {
    settingsCache = null;
    return await getSettings();
}

module.exports = { getSettings, refreshSettings };
