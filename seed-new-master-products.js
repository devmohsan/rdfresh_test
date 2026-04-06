require('dotenv').config();
const { db } = require('./firebase/db');
const { getSettings } = require('./services/settingsService');

const products = [
    // Customer Visibility Products
    {
        name: "All In One Cooler",
        sku: "610877687869",
        price: 29.95,
        description: "Moisture Odor Produce",
        visibility: "customer",
        active: true,
        weightOz: 16
    },
    {
        name: "Produce Cooler",
        sku: "610877687831",
        price: 29.95,
        description: "Produce Only Cooler",
        visibility: "customer",
        active: true,
        weightOz: 16
    },
    {
        name: "Protein Cooler",
        sku: "610877687817",
        price: 29.95,
        description: "Meats Only Cooler",
        visibility: "customer",
        active: true,
        weightOz: 16
    },
    {
        name: "Dairy Cooler",
        sku: "610877687800",
        price: 29.95,
        description: "Moisture & Odor Control",
        visibility: "customer",
        active: true,
        weightOz: 16
    },
    {
        name: "Bakery/Deserts Cooler",
        sku: "610877687756",
        price: 29.95,
        description: "Moisture Odor Produce",
        visibility: "customer",
        active: true,
        weightOz: 16
    },
    {
        name: "12VegieFresh POP Display",
        sku: "10793573914252",
        price: 120.00,
        description: "12 Count VegieFresh Counter Display",
        visibility: "customer",
        active: true,
        weightOz: 120
    },
    {
        name: "48 VegieFresh POP Display",
        sku: "50793573914250",
        price: 480.00,
        description: "48 Count VegieFresh Floor Display",
        visibility: "customer",
        active: true,
        weightOz: 480
    },
    {
        name: "48 VegieFresh Refill Box",
        sku: "40793573914253",
        price: 432.00,
        description: "48 Count VegieFresh Refill Box",
        visibility: "customer",
        active: true,
        weightOz: 384
    },
    // Distributor Visibility Products
    {
        name: "New Distributor RD Fresh Pallet",
        sku: "610877687824",
        price: 14050.00,
        description: "19 Boxes of Moisture, 19 Boxes of Odor, 9.5 Boxes of Produce, 6 Boxes of Panels",
        visibility: "distributor",
        active: true,
        weightOz: 10000 // Placeholder for bulk pallet
    },
    {
        name: "RD Fresh Moisture Bags",
        sku: "610877687770",
        price: 237.50,
        description: "Box of 50 Moisture Bags",
        visibility: "distributor",
        active: true,
        weightOz: 160
    },
    {
        name: "RD Fresh Odor Bags",
        sku: "610877687787",
        price: 287.50,
        description: "Box of 50 Odor Bags",
        visibility: "distributor",
        active: true,
        weightOz: 160
    },
    {
        name: "RD Fresh Produce Bags",
        sku: "610877687763",
        price: 350.00,
        description: "Box of 100 Produce Bags",
        visibility: "distributor",
        active: true,
        weightOz: 320
    },
    {
        name: "RD Fresh Reach In Bags",
        sku: "610877677628",
        price: 337.50,
        description: "Box of 50 Reach In Bags",
        visibility: "distributor",
        active: true,
        weightOz: 160
    },
    {
        name: "RD Fresh Panels",
        sku: "610877677629",
        price: 600.00,
        description: "Box of 50 Panels",
        visibility: "distributor",
        active: true,
        weightOz: 400
    },
    {
        name: "1 VegieFresh",
        sku: "9357391425",
        price: 19.95,
        description: "1 Pack of VegieFresh",
        visibility: "distributor",
        active: true,
        weightOz: 16
    },
    {
        name: "2 VegiFresh",
        sku: "93573914252",
        price: 29.95,
        description: "2 Packs of VegieFresh",
        visibility: "distributor",
        active: true,
        weightOz: 32
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
        description: productData.description || '',
        active: true
    };

    try {
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
    } catch (err) {
        console.error(`❌ Fetch Error for ${productData.sku}:`, err.message);
        return null;
    }
}

async function seedMasterProducts() {
    console.log("🚀 Starting Master Product Seeding (Customer & Distributor)...");

    for (const product of products) {
        try {
            console.log(`\n📦 Processing: ${product.name} (${product.sku}) - ${product.visibility}`);

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

    console.log("\n✨ Master Seeding Process Finished!");
    process.exit();
}

// NOTE: Uncomment the line below to run the script.
seedMasterProducts();

// console.log("Script created. To run it, uncomment 'seedMasterProducts()' at the end of the file and run: node seed-new-master-products.js");
