/* eslint-disable no-lonely-if */
const dotenv = require('dotenv');
const express = require('express');
const { chromium } = require('playwright');
const morgan = require('morgan');
const helmet = require('helmet');
const dynamoose = require('dynamoose');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const stripe = require('stripe')(
    'sk_test_51O0XLUAUT5H40gaHyIQynOOgqJSqWRCnxRptoMo7KR5dVTQvpEA30LEMQcjS6fuJlTotxJGigypJUMvhIBBHDlfH004U6EJ8Yu'
);

dotenv.config();

const cookieParser = require('cookie-parser');
const redis = require('./Utility/redisConnector');
const Webpage = require('./Models/Webpage');
const {
    saveToS3,
    cleanCachedString,
    getPageDescription,
} = require('./Utility/utils');

const app = express();

const ddb = new dynamoose.aws.ddb.DynamoDB(
    process.env.ENV === 'dev'
        ? {
              endpoint: 'http://localhost:4566',
              credentials: {
                  accessKeyId: 'mykey',
                  secretAccessKey: 'mykey',
              },
              region: process.env.AWS_REGION,
          }
        : {
              credentials: {
                  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
              },
              region: process.env.AWS_REGION,
          }
);

dynamoose.aws.ddb.set(ddb);

app.use(cors());
app.set('trust proxy', true);

app.use(helmet());

app.use(morgan('dev'));
app.use(
    express.json({
        limit: process.env.MAX_BODY_SIZE_EXPRESS,
    })
);

app.use(cookieParser());

app.post('/v2/general', async (req, res) => {
    const { url } = req.body;
    const apiKey = req.get('x-api-key');

    console.log(url, apiKey);

    // Check if API key and URL are provided
    if (!url || !apiKey) {
        return res
            .status(400)
            .json({ error: 'Missing required parameters or API key' });
    }

    // Validate API key
    if (apiKey !== process.env.WASP_API_KEY) {
        return res.status(403).json({ error: 'Invalid API Key' });
    }

    // Check cache
    const cachedData = await redis.get(url);
    if (cachedData) {
        // console.log(cleanCachedString(cachedData));
        return res.json({ url, page: cleanCachedString(cachedData) });
    }

    const browser = await chromium.launch();
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
    });

    context.on('request', (request) => {
        console.log(`🚀 Request made: ${request.method()} ${request.url()}`);
    });

    context.on('requestfailed', (request) => {
        console.log(
            `❌ Request failed: ${request.method()} ${request.url()} - ${
                request.failure().errorText
            }`
        );
    });

    context.on('response', (response) => {
        console.log(
            `🆗 Response received: ${response
                .request()
                .method()} ${response.url()} - ${response.status()}`
        );
    });

    const page = await context.newPage();

    try {
        console.log('Waiting for the page to load....');
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 0 });

        const pageContent = await page.content();
        const pageTitle = await page.title();
        const pageDescription = await getPageDescription(page);

        // Store to cache for 48 hours
        await redis.set(url, pageContent, 'EX', 3600 * 48);

        //Save the webpage to DynamoDB, it it already exists, update
        const checkWebsite = await Webpage.query('url').eq(url).exec();

        if (checkWebsite.count <= 0) {
            const s3Ref = await saveToS3('webpages-blob', pageContent);

            const webpage = new Webpage({
                id: uuidv4(),
                url,
                title: pageTitle,
                description: pageDescription,
                content_uri: s3Ref,
            });

            await webpage.save();
        } else {
            const s3Ref = await saveToS3('webpages-blob', pageContent);

            if (checkWebsite[0]?.id) {
                await Webpage.update(
                    { id: checkWebsite[0]?.id },
                    {
                        title: pageTitle,
                        description: pageDescription,
                        content_uri: s3Ref,
                    }
                );
            }
        }

        return res.json({ url, page: pageContent });
    } catch (error) {
        console.error('Error fetching page:', error.message);
        console.log(error);
        return res.status(500).json({ error: 'Failed to fetch page' });
    } finally {
        await browser.close();
    }
});

//PAYMENT
app.get('/prices', async (req, res) => {
    try {
        const prices = await stripe.prices.list({ limit: 5 });

        const filteredPrices = prices.data.map((price) => ({
            id: price?.id,
            lookupKey: price?.lookup_key,
            price: price.unit_amount / 100,
        }));

        console.log(prices);

        res.send({
            status: 'success',
            data: filteredPrices,
        });
    } catch (err) {
        res.status(500).send({ error: { message: err.message } });
    }
});

app.post('/subscription', async (req, res) => {
    const { customerId, priceId } = req.body;

    try {
        // Retrieve the existing subscriptions for the customer
        const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'active',
        });

        let subscription;

        // If an active subscription exists, update it
        if (subscriptions.data.length > 0) {
            subscription = subscriptions.data[0];

            // Update the subscription to use the new priceId at the end of the billing period
            // await stripe.subscriptions.update(subscription.id, {
            //     items: [
            //         {
            //             id: subscription.items.data[0].id,
            //             price: priceId,
            //         },
            //     ],
            //     // proration_behavior: 'create_prorations', // This will prorate the subscription
            //     billing_cycle_anchor: 'unchanged', // This will anchor the billing cycle to now, thus keeping the billing cycle same
            //     cancel_at_period_end: false, // This ensures the subscription does not cancel at the period end
            // });
            subscription = await stripe.subscriptions.retrieve(
                subscription.id,
                {
                    expand: ['default_payment_method'],
                }
            );
            const paymentMethod = subscription.default_payment_method;

            if (!paymentMethod) {
                subscription = await stripe.subscriptions.create({
                    customer: customerId,
                    items: [
                        {
                            price: priceId,
                        },
                    ],
                    payment_behavior: 'default_incomplete',
                    expand: ['latest_invoice.payment_intent'],
                    cancel_at_period_end: false,
                    payment_settings: {
                        save_default_payment_method: 'on_subscription',
                    },
                    metadata: { userId: 'userID' },
                });
            } else {
                await stripe.subscriptions.update(subscription.id, {
                    payment_behavior: 'pending_if_incomplete',
                    proration_behavior: 'none',
                    items: [
                        {
                            id: subscription.items.data[0].id,
                            price: priceId,
                        },
                    ],
                });
            }
        }
        // If no active subscription exists, create a new one
        else {
            subscription = await stripe.subscriptions.create({
                customer: customerId,
                items: [
                    {
                        price: priceId,
                    },
                ],
                payment_behavior: 'default_incomplete',
                expand: ['latest_invoice.payment_intent'],
                cancel_at_period_end: false,
                payment_settings: {
                    save_default_payment_method: 'on_subscription',
                },
                metadata: { userId: 'userID' },
            });
        }

        // Response structure similar to the provided one
        if (subscription.status === 'active') {
            // Fetching the new price
            const newPrice = await stripe.prices.retrieve(priceId);
            const newPriceLookupKey = newPrice.lookup_key;
            let upgradedOrDowngraded = null;

            // Determine if it's an upgrade or downgrade by comparing amounts
            const currentAmount = subscription.items.data[0].price.unit_amount;
            const newAmount = newPrice.unit_amount;

            if (newAmount > currentAmount) {
                upgradedOrDowngraded = 'upgraded';
            } else if (newAmount < currentAmount) {
                upgradedOrDowngraded = 'downgraded';
            } else {
                upgradedOrDowngraded = 'same';
            }

            // Responding to the client
            res.status(200).json({
                status: 'success',
                subscription,
                upgradedOrDowngraded,
                newPriceLookupKey,
            });
        } else {
            // Check if there's a pending setup intent
            if (subscription.pending_setup_intent) {
                const setupIntent = await stripe.setupIntents.retrieve(
                    subscription.pending_setup_intent
                );
                res.status(200).json({
                    status: 'success',
                    setupIntentClientSecret: setupIntent.client_secret,
                });
            } else {
                res.status(200).json({
                    status: 'success',
                    subscriptionId: subscription.id,
                    clientSecret:
                        subscription.latest_invoice.payment_intent
                            .client_secret,
                });
            }
        }
    } catch (err) {
        console.log(err);
        res.status(500).send({ error: { message: err.message } });
    }
});

// app.post('/subscription', async (req, res) => {
//     const { customerId, priceId } = req.body;

//     try {
//         const subscription = await stripe.subscriptions.create({
//             customer: customerId,
//             items: [
//                 {
//                     price: priceId,
//                 },
//             ],
//             payment_behavior: 'default_incomplete',
//             expand: ['latest_invoice.payment_intent'],
//             cancel_at_period_end: false,
//             payment_settings: {
//                 save_default_payment_method: 'on_subscription',
//             },
//             metadata: { userId: 'userID' },
//         });

//         if (subscription.status === 'active') {
//             const setupIntent = await this.stripeClient.retrieveSetupIntent(
//                 subscription.pending_setup_intent
//             );
//             res.status(200).json({
//                 status: 'success',
//                 setupIntentClientSecret: setupIntent.client_secret,
//             });
//         } else {
//             res.status(200).json({
//                 status: 'success',
//                 subscriptionId: subscription.id,
//                 clientSecret:
//                     subscription.latest_invoice.payment_intent.client_secret,
//             });
//         }
//     } catch (err) {
//         res.status(500).send({ error: { message: err.message } });
//     }
// });

app.listen(process.env.PORT, () => {
    console.log(`Server is running on http://localhost:${process.env.PORT}`);
});
