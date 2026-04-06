const OAuthClient = require('intuit-oauth');
const QuickBooks = require('node-quickbooks');
const { db } = require('../firebase/db');
const { getSettings } = require('./settingsService');

class QuickBooksService {
    constructor() {
        this.oauthClient = null;
        this.qbo = null;
        this.tokens = null;
        this.environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
        this.realmId = null;
    }

    async ensureConfigured() {
        if (this.oauthClient) return;

        const settings = await getSettings();
        const clientId = settings.QB_clientId || process.env.QB_clientId;
        const clientSecret = settings.QB_SKId || process.env.QB_SKId;
        const redirectUri = settings.QUICKBOOKS_REDIRECT_URI || process.env.QUICKBOOKS_REDIRECT_URI || 'http://localhost:3000/quickbooks/callback';

        this.oauthClient = new OAuthClient({
            clientId: clientId,
            clientSecret: clientSecret,
            environment: this.environment,
            redirectUri: redirectUri
        });
        
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    // Ensure tokens are valid and refresh if necessary
    async validateAndRefreshToken() {
        await this.ensureConfigured();
        try {
            const qbSettings = await db.collection('settings').doc('quickbooks').get();
            if (!qbSettings.exists) {
                throw new Error('QuickBooks not connected');
            }

            const data = qbSettings.data();
            let tokens = data.tokens;
            const realmId = data.realmId;

            // QuickBooks access tokens expire in 60 minutes (3600 seconds)
            // We refresh if it's older than 55 minutes to be safe
            const connectedAt = new Date(data.connectedAt || tokens.createdAt || Date.now());
            const now = new Date();
            const diffInMinutes = (now - connectedAt) / (1000 * 60);

            if (diffInMinutes > 55) {
                console.log('🔄 QuickBooks token expired or near expiration, refreshing...');
                const authResponse = await this.oauthClient.refreshUsingToken(tokens.refresh_token);
                tokens = authResponse.getJson();
                
                // Save new tokens to Firestore
                await db.collection('settings').doc('quickbooks').update({
                    tokens: tokens,
                    connectedAt: new Date().toISOString()
                });
                console.log('✅ QuickBooks tokens refreshed and saved.');
            }

            this.initializeClient(tokens, realmId);
            return tokens;
        } catch (error) {
            console.error('❌ QuickBooks validateAndRefreshToken error:', error.message);
            throw error;
        }
    }

    // Get authorization URL
    async getAuthUri() {
        await this.ensureConfigured();
        return this.oauthClient.authorizeUri({
            scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.Payment],
            state: 'testState'
        });
    }

    // Handle OAuth callback
    async handleCallback(url) {
        await this.ensureConfigured();
        try {
            const authResponse = await this.oauthClient.createToken(url);
            this.tokens = authResponse.getJson();
            
            console.log('QB Callback success. RealmId:', this.tokens.realmId);
            
            // Initialize QuickBooks client
            this.qbo = new QuickBooks(
                this.clientId,
                this.clientSecret,
                this.tokens.access_token,
                false, // no token secret for oAuth 2.0
                this.tokens.realmId,
                this.environment === 'sandbox', // use sandbox
                true, // enable debugging
                null, // set minorversion
                '2.0', // oAuth version
                this.tokens.refresh_token
            );

            return {
                success: true,
                realmId: this.tokens.realmId,
                tokens: this.tokens
            };
        } catch (error) {
            console.error('QuickBooks OAuth error:', error);
            throw error;
        }
    }

    // Refresh access token
    async refreshToken(refreshToken) {
        try {
            const authResponse = await this.oauthClient.refreshUsingToken(refreshToken);
            this.tokens = authResponse.getJson();
            return this.tokens;
        } catch (error) {
            console.error('Token refresh error:', error);
            throw error;
        }
    }

    // Initialize QB client with stored tokens
    initializeClient(tokens, realmId) {
        this.tokens = tokens;
        const finalRealmId = realmId || tokens.realmId;
        
        if (!finalRealmId) {
            console.error('❌ QuickBooks Initialization Error: No RealmId provided!');
        }

        this.qbo = new QuickBooks(
            process.env.QB_clientId,
            process.env.QB_SKId,
            tokens.access_token,
            false,
            finalRealmId,
            this.environment === 'sandbox',
            true,
            null,
            '2.0',
            tokens.refresh_token
        );
    }

    // Create Customer in QuickBooks
    async createCustomer(userData) {
        if (!this.qbo) {
            throw new Error('QuickBooks client not initialized');
        }

        const customer = {
            DisplayName: userData.name,
            PrimaryEmailAddr: {
                Address: userData.email
            },
            CompanyName: userData.company || '',
            GivenName: userData.name.split(' ')[0],
            FamilyName: userData.name.split(' ').slice(1).join(' ')
        };

        return new Promise((resolve, reject) => {
            this.qbo.createCustomer(customer, (err, customer) => {
                if (err) {
                    console.error('Create customer error:', err);
                    reject(err);
                } else {
                    resolve(customer);
                }
            });
        });
    }

    // Create Invoice
    async createInvoice(invoiceData) {
        if (!this.qbo) {
            throw new Error('QuickBooks client not initialized');
        }

        const invoice = {
            CustomerRef: {
                value: invoiceData.customerId
            },
            Line: invoiceData.items.map(item => ({
                DetailType: 'SalesItemLineDetail',
                Amount: item.price * item.quantity,
                SalesItemLineDetail: {
                    ItemRef: {
                        value: '1' // Default item - you can create specific items
                    },
                    Qty: item.quantity,
                    UnitPrice: item.price
                },
                Description: item.productName
            })),
            TxnTaxDetail: {
                TotalTax: invoiceData.tax || 0
            }
        };

        return new Promise((resolve, reject) => {
            this.qbo.createInvoice(invoice, (err, invoice) => {
                if (err) {
                    console.error('Create invoice error:', err);
                    reject(err);
                } else {
                    resolve(invoice);
                }
            });
        });
    }

    // Create Payment
    async createPayment(paymentData) {
        if (!this.qbo) {
            throw new Error('QuickBooks client not initialized');
        }

        const payment = {
            CustomerRef: {
                value: paymentData.customerId
            },
            TotalAmt: paymentData.amount,
            Line: [
                {
                    Amount: paymentData.amount,
                    LinkedTxn: [
                        {
                            TxnId: paymentData.invoiceId,
                            TxnType: 'Invoice'
                        }
                    ]
                }
            ]
        };

        return new Promise((resolve, reject) => {
            this.qbo.createPayment(payment, (err, payment) => {
                if (err) {
                    console.error('Create payment error:', err);
                    reject(err);
                } else {
                    resolve(payment);
                }
            });
        });
    }

    // Get Customer by email
    async findCustomerByEmail(email) {
        if (!this.qbo) {
            throw new Error('QuickBooks client not initialized');
        }

        return new Promise((resolve, reject) => {
            this.qbo.findCustomers([
                { field: 'PrimaryEmailAddr', value: email, operator: '=' }
            ], (err, customers) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(customers.QueryResponse?.Customer?.[0] || null);
                }
            });
        });
    }

    // Create Sales Receipt (for direct payment without invoice)
    async createSalesReceipt(receiptData) {
        if (!this.qbo) {
            throw new Error('QuickBooks client not initialized');
        }

        const salesReceipt = {
            CustomerRef: {
                value: receiptData.customerId
            },
            Line: receiptData.items.map(item => ({
                DetailType: 'SalesItemLineDetail',
                Amount: item.price * item.quantity,
                SalesItemLineDetail: {
                    ItemRef: {
                        value: '1'
                    },
                    Qty: item.quantity,
                    UnitPrice: item.price
                },
                Description: item.productName
            })),
            TotalAmt: receiptData.total,
            PaymentMethodRef: {
                value: '1' // Cash/Card - adjust as needed
            }
        };

        return new Promise((resolve, reject) => {
            this.qbo.createSalesReceipt(salesReceipt, (err, receipt) => {
                if (err) {
                    console.error('Create sales receipt error:', err);
                    reject(err);
                } else {
                    resolve(receipt);
                }
            });
        });
    }
}

module.exports = new QuickBooksService();
