require('dotenv').config();
const { db } = require('./firebase/db');
const { getSettings } = require('./services/settingsService');

const products = [
    {
        name: "All in One Cooler",
        sku: "RET-AIC",
        price: 29.95,
        weightOz: 16, // Approx weight
        internalNotes: "Retail Product",
        visibility: "customer",
        active: true
    },
    {
        name: "Produce Cooler",
        sku: "RET-PC",
        price: 29.95,
        weightOz: 16,
        internalNotes: "Retail Product",
        visibility: "customer",
        active: true
    },
    {
        name: "Protien Cooler",
        sku: "RET-PRC",
        price: 29.95,
        weightOz: 16,
        internalNotes: "Retail Product",
        visibility: "customer",
        active: true
    },
    {
        name: "Dairy Cooler",
        sku: "RET-DC",
        price: 29.95,
        weightOz: 16,
        internalNotes: "Retail Product",
        visibility: "customer",
        active: true
    },
    {
        name: "Bakery/Desert Cooler",
        sku: "RET-BC",
        price: 29.95,
        weightOz: 16,
        internalNotes: "Retail Product",
        visibility: "customer",
        active: true
    },
    {
        name: "48 POP Display",
        sku: "RET-POP-48",
        price: 480.00,
        weightOz: 480, // Approx 30 lbs
        internalNotes: "Retail POP Display",
        visibility: "customer",
        active: true
    },
    {
        name: "12 POP Display",
        sku: "RET-POP-12",
        price: 120.00,
        weightOz: 120, // Approx 7.5 lbs
        internalNotes: "Retail POP Display",
        visibility: "customer",
        active: true
    },
    {
        name: "48 Refill Box",
        sku: "RET-REFILL-48",
        price: 432.00,
        weightOz: 384, // Approx 24 lbs
        internalNotes: "Retail Refill Box",
        visibility: "customer",
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
    console.log("🚀 Starting Retail Products Seeding...");

    for (const product of products) {
        try {
            console.log(`\n📦 Processing: ${product.name} (${product.sku})`);

            // 1. Sync to ShipStation
            const ssResult = await syncToShipStation(product);
            
            if (ssResult && ssResult.productId) {
                const ssProductId = ssResult.productId.toString();
                
                // 2. Save to Firestore
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
