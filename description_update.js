const { db } = require('./firebase/db');
const { getSettings } = require('./services/settingsService');

async function bulkUpdateShipStationDescriptions() {
    // 🚩 Yahan apna data dain: [ { productId: "ID", description: "Nayi Description" }, ... ]
    const updates = [
        { productId: "57751771", 
            description: "Moisture, Produce" },
        { productId: "57751772", 
            description: "Moisture, Odor" },
        { productId: "57751773", 
            description: "Moisture, Odor" },
        { productId: "57751774", 
            description: "Moisture, Produce" },
        // Aur products yahan add karein...
    ];

    console.log(`🚀 Starting update for ${updates.length} products on ShipStation ONLY...`);

    try {
        const settings = await getSettings();
        const API_KEY = settings.API_KEY || process.env.API_KEY;
        const API_SK = settings.API_SK || process.env.API_SK;
        const auth = Buffer.from(`${API_KEY}:${API_SK}`).toString('base64');

        for (const update of updates) {
            try {
                // 1. Local database se current data uthayein (taki Name, SKU pass ho sakay)
                const doc = await db.collection('products').doc(update.productId).get();
                if (!doc.exists) {
                    console.error(`❌ Product ${update.productId} not found in local DB. Skipping.`);
                    continue;
                }
                const currentData = doc.data();

                // 2. ShipStation Payload tayyar karein
                const payload = {
                    description: update.description // ✨ Nayi description yahan add ho rahi hai
                };

                // 3. ShipStation API call (PUT request)
                const response = await fetch(`https://ssapi.shipstation.com/products/${update.productId}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Basic ${auth}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    console.log(`✅ ${currentData.sku} (ID: ${update.productId}): Description updated on ShipStation.`);
                } else {
                    const err = await response.text();
                    console.error(`❌ Failed to update ${currentData.sku}: ${err}`);
                }

            } catch (err) {
                console.error(`❌ Error processing ID ${update.productId}:`, err.message);
            }
        }

        console.log('🏁 Bulk update process finished.');

    } catch (error) {
        console.error('❌ Critical Error:', error.message);
    }
    process.exit();
}

bulkUpdateShipStationDescriptions();
