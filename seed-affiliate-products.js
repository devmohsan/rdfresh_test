require('dotenv').config();
const { db } = require('./firebase/db');
const { getSettings } = require('./services/settingsService');

/**
 * Replace the values in the 'products' array with the actual affiliate products later.
 * For now, these are placeholder items.
 */
const products = [
    {
        name: "1-12 Pack Countertop POP Display with 1-36 Pack Display Refill Box",
        sku: "98765432234",
        price: 480.00, // Placeholder
        weightOz: 192, // 12 lbs placeholder
        internalNotes: "Affiliate Wholesale Item ",
        description: "1-12 Pack Countertop POP Display with 1-36 Pack Display Refill Box",
        visibility: "affiliate",
        active: true
    },
    // {
    //     name: "50- Table tants 4.25' x 6 full color Double sided video Qrcode",
    //     sku: "2345432345",
    //     price: 50.00, // Placeholder
    //     weightOz: 768, // 48 lbs placeholder
    //     internalNotes: "Affiliate Wholesale Item ",
    //     description: "50- Table tants 4.25' x 6 full color Double sided video Qrcode",
    //     visibility: "affiliate",
    //     active: true
    // },
    // {
    //     name: "50- Table tants 4.25' x 6 full color Double sided fully customized wih your affiliate qecode and video qrcode",
    //     sku: "2345432346",
    //     price: 120.00, // Placeholder
    //     weightOz: 576, // 36 lbs placeholder
    //     internalNotes: "Affiliate Wholesale Item",
    //     description: "50- Table tants 4.25' x 6 full color Double sided fully customized wih your affiliate qecode and video qrcode",
    //     visibility: "affiliate",
    //     active: true
    // },
    //     {
    //     name: "2500 check inserts 2'x3' full color double sided fully customized",
    //     sku: "2345432347",
    //     price: 100.00, // Placeholder
    //     weightOz: 576, // 36 lbs placeholder
    //     internalNotes: "Affiliate Wholesale Item",
    //     description: "2500 check inserts 2'x3' full color double sided fully customized",
    //     visibility: "affiliate",
    //     active: true
    // }
    // ,
    //     {
    //     name: "1000 - Flayers Handouts 5.5'X8.5' full color double sided fully customized",
    //     sku: "2345432348",
    //     price: 150.00, // Placeholder
    //     weightOz: 576, // 36 lbs placeholder
    //     internalNotes: "Affiliate Wholesale Item",
    //     description: "1000 - Flayers Handouts 5.5'X8.5' full color double sided fully customized",
    //     visibility: "affiliate",
    //     active: true
    // }
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
    } catch (error) {
        console.error(`❌ Network Error syncing ${productData.sku}:`, error.message);
        return null;
    }
}

async function seedAffiliateProducts() {
    console.log("🚀 Starting Affiliate Products Seeding...");

    for (const product of products) {
        try {
            console.log(`\n📦 Processing: ${product.name} (${product.sku})`);

            // 1. Sync to ShipStation
            const ssResult = await syncToShipStation(product);
            
            if (ssResult && (ssResult.productId || ssResult.id)) {
                // ShipStation returns productId or id depending on the context
                const ssProductId = (ssResult.productId || ssResult.id).toString();
                
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

    console.log("\n✨ Affiliate Seeding Process Finished!");
    process.exit();
}

seedAffiliateProducts();
