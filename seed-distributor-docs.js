const { db, storage } = require('./firebase/db');
const fs = require('fs');
const path = require('path');

// ==========================================
// CONFIGURATION: Place your directory path here
// ==========================================
const SOURCE_DIRECTORY = 'C:/Users/Developer/Downloads/affiliate'; 
// ==========================================

async function generateLibraryFromLocal() {
    console.log("🚀 Starting Document Library Generation & Upload...");

    try {
        if (!fs.existsSync(SOURCE_DIRECTORY)) {
            console.error("❌ Source directory does not exist. Please check the path.");
            return;
        }

        const bucket = storage.bucket();
        const libraryData = {
            category: "affiliate",
            lastUpdated: new Date().toISOString(),
            sections: []
        };

        // Read all sub-folders (Sections)
        const entries = fs.readdirSync(SOURCE_DIRECTORY, { withFileTypes: true });
        
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const sectionName = entry.name.replace(/_/g, ' '); 
                const sectionPath = path.join(SOURCE_DIRECTORY, entry.name);
                
                console.log(`\n📂 Processing Section: ${sectionName}`);

                const section = {
                    title: sectionName,
                    slug: entry.name.toLowerCase().replace(/ /g, '-'),
                    documents: []
                };

                // Read files inside this folder
                const files = fs.readdirSync(sectionPath);
                for (const fileName of files) {
                    const filePath = path.join(sectionPath, fileName);
                    const stats = fs.statSync(filePath);

                    if (stats.isFile()) {
                        console.log(`   ⬆️ Uploading: ${fileName}...`);
                        
                        const destination = `affiliate/${entry.name}/${fileName}`;
                        
                        // 1. Upload to Firebase Storage
                        await bucket.upload(filePath, {
                            destination: destination,
                            metadata: {
                                cacheControl: 'public, max-age=31536000',
                            }
                        });

                        // 2. Make file public and get URL
                        const file = bucket.file(destination);
                        await file.makePublic();
                        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(destination)}`;

                        section.documents.push({
                            title: fileName.replace(/\.[^/.]+$/, "").replace(/_/g, ' '), 
                            fileName: fileName,
                            fileSize: (stats.size / 1024).toFixed(2) + ' KB',
                            url: publicUrl,
                            uploadedAt: new Date().toISOString()
                        });
                        console.log(`   ✅ Success: ${fileName}`);
                    }
                }

                if (section.documents.length > 0) {
                    libraryData.sections.push(section);
                }
            }
        }

        // 3. Save everything to Firestore
        await db.collection('document_library').doc('affiliate_resources').set(libraryData);

        console.log("\n✨ EVERYTHING DONE!");
        console.log(`📍 Category: ${libraryData.category}`);
        console.log(`📦 Sections Created: ${libraryData.sections.length}`);
        
    } catch (error) {
        console.error("\n❌ Error during processing:", error.message);
    } finally {
        process.exit();
    }
}

generateLibraryFromLocal();
