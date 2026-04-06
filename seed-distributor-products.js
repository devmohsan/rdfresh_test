require('dotenv').config();
const { db } = require('./firebase/db');
const { getSettings } = require('./services/settingsService');

const products = [
    {
        name: "1 Box of 50 Moisture Bags",
        sku: "DIST-MB-50",
        price: 150.00, // Placeholder price
        weightOz: 160, // Placeholder weight (10 lbs)
        internalNotes: "Distributor Wholesale Item",
        visibility: "distributor",
        active: true
    },
    {
        name: "1 Box of 50 Odor Bags",
        sku: "DIST-OB-50",
        price: 150.00,
        weightOz: 160,
        internalNotes: "Distributor Wholesale Item",
        visibility: "distributor",
        active: true
    },
    {
        name: "1 Box of 100 Produce Bags",
        sku: "DIST-PB-100",
        price: 250.00,
        weightOz: 320, // 20 lbs
        internalNotes: "Distributor Wholesale Item",
        visibility: "distributor",
        active: true
    },
    {
        name: "1 Box of 50 Reach-In Bags",
        sku: "DIST-RB-50",
        price: 150.00,
        weightOz: 160,
        internalNotes: "Distributor Wholesale Item",
        visibility: "distributor",
        active: true
    },
    {
        name: "1 Box of 50 Panels",
        sku: "DIST-PN-50",
        price: 300.00,
        weightOz: 400, // 25 lbs
        internalNotes: "Distributor Wholesale Item",
        visibility: "distributor",
        active: true
    }
];

async function syncToShipStation(productData) {
    const settings = await getSettings();
    const API_KEY = settings.API_KEY || process.env.API_KEY;
    const API_SK = settings.API_SK || process.env.API_SK;

    if (!API_KEY || !API_SK) {
        throw new Error("ShipStation API credentials missing in .env or settings.");
    }

    const auth = Buffer.from(`${API_KEY}:${API_SK}`).toString('base64');
    
    const payload = {
        sku: productData.sku,
        name: productData.name,
        price: parseFloat(productData.price || 0),
        weightOz: parseFloat(productData.weightOz || 0),
        internalNotes: productData.internalNotes || '',
        active: true
    };

    const response = await fetch('https://ssapi.shipstation.com/products/createproduct', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
        console.error(`❌ ShipStation Error for ${productData.sku}:`, data);
        return null;
    }
    return data;
}

async function seedProducts() {
    console.log("🚀 Starting Distributor Products Seeding...");

    for (const product of products) {
        try {
            console.log(`\n📦 Processing: ${product.name} (${product.sku})`);

            // 1. Sync to ShipStation
            const ssResult = await syncToShipStation(product);
            
            if (ssResult && ssResult.productId) {
                const ssProductId = ssResult.productId.toString();
                
                // 2. Save to Firestore (using ShipStation ID to keep them in sync)
                await db.collection('products').doc(ssProductId).set({
                    ...product,
                    productId: ssProductId,
                    lastSyncAt: new Date().toISOString()
                });

                console.log(`✅ Successfully added and synced. ID: ${ssProductId}`);
            } else {
                console.log(`⚠️ Skipped Firestore because ShipStation sync failed.`);
            }
        } catch (error) {
            console.error(`❌ Error seeding ${product.sku}:`, error.message);
        }
    }

    console.log("\n✨ Seeding Process Finished!");
    process.exit();
}

seedProducts();
