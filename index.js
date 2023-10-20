/* eslint-disable no-lonely-if */
const dotenv = require('dotenv');
// eslint-disable-next-line import/no-extraneous-dependencies
const jwt = require('jsonwebtoken');
// eslint-disable-next-line import/no-extraneous-dependencies
const bcrypt = require('bcrypt');
// eslint-disable-next-line import/no-extraneous-dependencies
const Cryptr = require('cryptr');
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
const bodyParser = require('body-parser');
const redis = require('./Utility/redisConnector');
const Webpage = require('./Models/Webpage');
const UserModel = require('./Models/User');
const SubscriptionModel = require('./Models/Subscription');

const {
    saveToS3,
    cleanCachedString,
    getPageDescription,
    generateAPIKey,
    giveFreeFirstTimeSignupCredits,
    getUserCurrentBalance,
    getUserProfile,
    updateSubscription,
} = require('./Utility/utils');
const sendEmail = require('./Utility/sendEmail');
const createRateLimiter = require('./Utility/createRateLimiter');
const authenticate = require('./Middlewares/authenticate');
const {
    checkCredits,
    deductCredits,
} = require('./Middlewares/creditsManagement');
const {
    createDynamicConcurrencyMiddleware,
} = require('./Middlewares/dynamicConcurrency');

const dynamicConcurrencyLimiter = createDynamicConcurrencyMiddleware();

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

app.use(
    cors({
        origin: ['http://localhost:3000', 'http://localhost:3000/'],
        credentials: true,
    })
);
// app.set('trust proxy', true);

app.use(helmet());
app.use(morgan('dev'));

app.post(
    '/webhook',
    // express.raw({ type: 'application/json' }),
    bodyParser.raw({ type: '*/*' }),
    async (req, res) => {
        let event;

        try {
            const stripeSigniture = req.headers['stripe-signature'];

            event = stripe.webhooks.constructEvent(
                req.body,
                stripeSigniture,
                process.env.STRIPE_WEBHOOK_SECRET
            );

            // event = stripe.webhooks.constructEvent(
            //             request.body,
            //             sig,
            //             process.env.STRIPE_WEBHOOK_SECRET
            //         );
        } catch (err) {
            console.error(err);
            res.status(400).send(`Webhook Error: ${err.message}`);
            return;
        }

        let eventObject;

        try {
            switch (event.type) {
                case 'customer.subscription.created':
                    eventObject = event.data.object;

                    await updateSubscription(eventObject, stripe);
                    break;

                case 'customer.subscription.updated':
                    eventObject = event.data.object;
                    await updateSubscription(eventObject, stripe);
                    break;

                case 'customer.subscription.deleted':
                    eventObject = event.data.object;
                    console.log('Subscription deleted');
                    break;

                default:
                    // Handle other types of events or ignore them
                    break;
            }
        } catch (error) {
            console.error('Error handling webhook event:', error);
            return res.status(500).send('Internal Server Error');
        }

        // Return a 200 response to acknowledge receipt of the event
        res.send();
        // try {
        //     const sig = request.headers['stripe-signature'];

        //     let event;

        //     try {
        //         const stripeSigniture = request.headers['stripe-signature'];

        //         event = stripe.webhooks.constructEvent(
        //             request.body,
        //             stripeSigniture,
        //             process.env.STRIPE_WEBHOOK_SECRET
        //         );

        //         // event = stripe.webhooks.constructEvent(
        //         //             request.body,
        //         //             sig,
        //         //             process.env.STRIPE_WEBHOOK_SECRET
        //         //         );
        //     } catch (err) {
        //         console.error(err);
        //         response.status(400).send(`Webhook Error: ${err.message}`);
        //         return;
        //     }

        //     // Handle the event
        //     let paymentIntentSucceeded;
        //     console.log(event);
        //     switch (event.type) {
        //         case 'payment_intent.succeeded':
        //             paymentIntentSucceeded = event.data.object;
        //             console.log(paymentIntentSucceeded);
        //             // Then define and call a function to handle the event payment_intent.succeeded
        //             break;
        //         // ... handle other event types
        //         default:
        //             console.log(`Unhandled event type ${event.type}`);
        //     }

        //     // Return a 200 response to acknowledge receipt of the event
        //     response.send();
        // } catch (error) {
        //     console.error(error);
        // }
    }
);

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

//USERS
app.post('/api/v1/signup', createRateLimiter(50, 60 * 15), async (req, res) => {
    const { firstname, lastname, email, password } = req.body;

    //? Create stripe user
    const stripeCustomer = await stripe.customers.create({
        email,
    });

    try {
        const standardEmail = email.toLowerCase().trim();
        //Check if the account is unique
        const previousAccount = await UserModel.query('email')
            .eq(standardEmail)
            .exec();

        if (previousAccount.count >= 0) {
            //New account
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            const verificationToken = uuidv4();

            const userId = uuidv4();

            await UserModel.create({
                id: userId,
                firstname,
                lastname,
                email,
                password: hashedPassword,
                verificationToken,
                stripe_customerId: stripeCustomer.id,
            });

            //? Generate API key
            await generateAPIKey(userId);

            //? Give free signup credits
            await giveFreeFirstTimeSignupCredits(userId);

            const verificationLink = `${process.env.APP_URL}/verifyEmail/${verificationToken}`;

            //Send the confirmation email
            sendEmail({
                email,
                fromEmail: 'hey@scraping.com',
                fromName: 'ScrapingWasp',
                subject: 'Verify your email',
                message: `Welcome to ScrapingWasp!\n\nHere is your verification token ${verificationLink}`,
            });

            res.json({
                status: 'success',
                data: {
                    id: userId,
                    firstname,
                    lastname,
                    email,
                },
            });
        } //Email taken
        else {
            res.json({
                status: 'fail',
                message: 'Email already taken!',
            });
        }
    } catch (error) {
        console.log(error);
        await stripe.customers.del(stripeCustomer.id);
        res.status(500).send({ error: { message: error.message } });
    }
});

app.post(
    '/api/v1/resendVerificationEmail',
    createRateLimiter(5, 60 * 15),
    async (req, res) => {
        try {
            //Check if the user has an account
            const { email } = req.body;

            const standardEmail = email.toLowerCase().trim();

            const previousAccount = await UserModel.query('email')
                .eq(standardEmail)
                .exec();

            if (previousAccount.count >= 0) {
                const verificationToken = uuidv4();

                await UserModel.update(
                    {
                        id: previousAccount[0]?.id,
                    },
                    {
                        verificationToken,
                    }
                );

                const verificationLink = `${process.env.APP_URL}/verifyEmail/${verificationToken}`;

                //Send the confirmation email
                sendEmail({
                    email,
                    fromEmail: 'hey@scraping.com',
                    fromName: 'ScrapingWasp',
                    subject: 'Verify your email',
                    message: `Welcome to ScrapingWasp!\n\nHere is your verification token ${verificationLink}`,
                });

                res.json({
                    status: 'success',
                    message: 'Email sent!',
                });
            } //No account
            else {
                res.json({
                    status: 'fail',
                    message: 'No account found with that email.',
                });
            }
        } catch (error) {
            res.status(500).send({ error: { message: error.message } });
        }
    }
);

app.post(
    '/api/v1/verifyEmail',
    createRateLimiter(15, 60 * 20),
    async (req, res) => {
        try {
            const { token } = req.body;

            if (token) {
                //Find the account with the token
                const accountHolder = await UserModel.scan()
                    .all()
                    .filter('verificationToken')
                    .eq(token.trim())
                    .exec();

                //...
                if (accountHolder.count > 0) {
                    //Valid
                    await UserModel.update(
                        {
                            id: accountHolder[0]?.id,
                        },
                        {
                            isVerified: true,
                            verificationToken: '',
                        }
                    );

                    res.json({
                        status: 'success',
                    });
                } else {
                    //Invalid
                    res.json({
                        status: 'fail',
                        message: 'Invalid verification link clicked.',
                    });
                }
            } else {
                res.json({
                    status: 'fail',
                    message: 'Something is wrong.',
                });
            }
        } catch (error) {
            res.status(500).send({ error: { message: error.message } });
        }
    }
);

app.post('/api/v1/login', createRateLimiter(50, 60 * 15), async (req, res) => {
    try {
        const { email, password } = req.body;

        if (email && password) {
            const standardEmail = email.toLowerCase().trim();

            const accountHolder = await UserModel.query('email')
                .eq(standardEmail)
                .exec();

            if (accountHolder.count > 0) {
                const validPassword = await bcrypt.compare(
                    password,
                    accountHolder[0]?.password
                );

                if (validPassword) {
                    const profile = await getUserProfile(accountHolder[0]);

                    const newToken = jwt.sign(
                        { user_id: accountHolder[0]?.id },
                        process.env.JWT_SECRET,
                        {
                            expiresIn: `${process.env.DEFAULT_SESSION_DURATION_H}h`,
                        }
                    );

                    const salt = await bcrypt.genSalt(10);
                    const hashedToken = await bcrypt.hash(newToken, salt);

                    await UserModel.update(
                        { id: accountHolder[0]?.id },
                        {
                            sessionToken: hashedToken,
                            lastTokenUpdate: Date.now(),
                        }
                    );

                    res.json({
                        status: 'success',
                        data: { ...profile, token: newToken },
                    });
                } else {
                    res.json({
                        status: 'fail',
                        message: 'Wrong email or password.',
                    });
                }
            } else {
                //No account
                res.json({
                    status: 'fail',
                    message: 'Wrong email or password.',
                });
            }
        } else {
            res.json({
                status: 'fail',
                message: 'Missing email or password',
            });
        }
    } catch (error) {
        res.status(500).send({ error: { message: error.message } });
    }
});

//API keys management
app.get('/api/v1/key', authenticate, async (req, res) => {
    try {
        const { user } = req;

        const cryptr = new Cryptr(process.env.API_KEYS_GEN_KEY);

        const decryptedApiKey = cryptr.decrypt(user.apiKey);

        res.json({
            status: 'success',
            data: decryptedApiKey,
        });
    } catch (error) {
        console.error(error);
        res.status(500).send({ error: { message: error.message } });
    }
});

app.get('/api/v1/key/regenerate', authenticate, async (req, res) => {
    try {
        const user = req.user.id;

        await generateAPIKey(user.id);

        res.json({
            status: 'success',
        });
    } catch (error) {
        res.status(500).send({ error: { message: error.message } });
    }
});

//PAYMENT
app.get('/prices', authenticate, async (req, res) => {
    try {
        const prices = await stripe.prices.list({ limit: 5 });

        const filteredPrices = prices.data.map((price) => ({
            id: price?.id,
            lookupKey: price?.lookup_key,
            price: price.unit_amount / 100,
        }));

        res.send({
            status: 'success',
            data: filteredPrices,
        });
    } catch (err) {
        res.status(500).send({ error: { message: err.message } });
    }
});

app.post('/subscription', authenticate, async (req, res) => {
    const { customerId, priceId, paymentMethodId } = req.body;
    const { user } = req;

    try {
        // Retrieve the existing subscriptions for the customer
        const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'active',
        });

        let subscription;

        if (paymentMethodId) {
            subscription = subscriptions.data[0];

            await stripe.subscriptions.update(subscription.id, {
                items: [
                    {
                        id: subscription.items.data[0].id,
                        price: priceId,
                    },
                ],
                default_payment_method: paymentMethodId,
                payment_behavior: 'default_incomplete',
                proration_behavior: 'none',
            });

            return res.json({
                status: 'success',
                state: 'paidWithPaymentId',
            });
        }

        // If an active subscription exists, update it
        if (subscriptions.data.length > 0) {
            subscription = subscriptions.data[0];

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
                    metadata: { userId: user.id },
                });
            } else {
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
                    metadata: { userId: user.id },
                });

                return res.json({
                    status: 'success',
                    state: 'alreadyHaveSubscriptionGivePaymentChoice',
                    clientSecret:
                        subscription.latest_invoice.payment_intent
                            .client_secret,
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
                metadata: { userId: user.id },
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

//BALANCE
app.get('/api/v1/balance', authenticate, async (req, res) => {
    try {
        const { user } = req.user;

        const balance = await getUserCurrentBalance(user.id);

        res.json({
            status: 'success',
            data: balance,
        });
    } catch (error) {
        res.status(500).send({ error: { message: error.message } });
    }
});

app.get('/api/v1/addcard_intent', authenticate, async (req, res) => {
    try {
        const { user } = req;

        const setupIntent = await stripe.setupIntents.create({
            customer: user.stripe_customerId,
        });

        res.send({
            status: 'success',
            data: setupIntent.client_secret,
        });
    } catch (error) {
        console.error(error);
        res.status(500).send({ error: { message: error.message } });
    }
});

app.get('/api/v1/payment_methods', authenticate, async (req, res) => {
    try {
        const { user } = req;

        const customer = await stripe.customers.retrieve(
            user.stripe_customerId
        );

        const paymentMethods = await stripe.paymentMethods.list({
            customer: user.stripe_customerId,
            type: 'card',
        });

        // If the customer doesn't have a default source, set the first card as default
        if (
            !customer.invoice_settings.default_payment_method &&
            paymentMethods.data.length > 0
        ) {
            await stripe.customers.update(user.stripe_customerId, {
                invoice_settings: {
                    default_payment_method: paymentMethods.data[0].id,
                },
            });
            customer.invoice_settings.default_payment_method =
                paymentMethods.data[0].id; // Update our local reference
        }

        // Map over the payment methods and add a "default" boolean property to each one
        const enrichedPaymentMethods = paymentMethods.data.map((method) => ({
            ...method,
            default:
                method.id === customer.invoice_settings.default_payment_method,
        }));

        res.json({
            status: 'success',
            count: enrichedPaymentMethods.length,
            data: enrichedPaymentMethods,
        });
    } catch (error) {
        console.error(error);
        res.status(500).send({ error: { message: error.message } });
    }
});

app.delete(
    '/api/v1/payment_methods/:paymentMethodId',
    // createRateLimiter(15, 60 * 10),
    authenticate,
    async (req, res) => {
        const { user } = req;
        const { paymentMethodId } = req.params;

        const customerId = user.stripe_customerId;

        if (!customerId || !paymentMethodId) {
            return res.status(400).json({
                status: 'error',
                message: 'Failed to remove the payment method.',
            });
        }

        try {
            // Retrieve the list of all payment methods for the customer
            const paymentMethods = await stripe.paymentMethods.list({
                customer: customerId,
                type: 'card',
            });

            // If only one payment method exists, don't remove it
            if (paymentMethods.data.length === 1) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Cannot remove the default payment method.',
                });
            }

            // Detach the specified payment method from the customer
            await stripe.paymentMethods.detach(paymentMethodId);

            // If the payment method being removed was the default, set a new default
            const customer = await stripe.customers.retrieve(customerId);
            if (
                customer.invoice_settings.default_payment_method ===
                paymentMethodId
            ) {
                const newDefaultPaymentMethod = paymentMethods.data.find(
                    (pm) => pm.id !== paymentMethodId
                );
                await stripe.customers.update(customerId, {
                    invoice_settings: {
                        default_payment_method: newDefaultPaymentMethod.id,
                    },
                });
            }

            res.json({
                status: 'success',
                message: 'Payment method removed successfully.',
            });
        } catch (error) {
            console.error(error.stack);
            res.status(500).json({
                status: 'error',
                message: 'Unable to remove the payment method.',
            });
        }
    }
);

//! Danger
app.post(
    '/api/v1/cancelSubscription',
    createRateLimiter(10, 60 * 15),
    authenticate,
    async (req, res) => {
        const { user } = req;

        const customerId = user.stripe_customerId;

        if (!customerId) {
            return res.status(400).json({
                status: 'error',
                message: 'customerId is required.',
            });
        }

        try {
            // Retrieve the subscriptions of the customer
            const subscriptions = await stripe.subscriptions.list({
                customer: customerId,
            });
            subscriptions.data = subscriptions.data.filter(
                (subscription) => subscription.status === 'active'
            );

            // If the customer has no active subscriptions
            if (subscriptions.data.length === 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'No active subscriptions found.',
                });
            }

            // Set cancel_at_period_end for all active subscriptions for the customer
            // (Note: You can modify this to target only a specific subscription if needed)
            // eslint-disable-next-line no-restricted-syntax
            for (const subscription of subscriptions.data) {
                // eslint-disable-next-line no-await-in-loop
                // await stripe.subscriptions.update(subscription.id, {
                //     cancel_at_period_end: true,
                // });
                // eslint-disable-next-line no-await-in-loop
                await stripe.subscriptions.delete(subscription.id);
            }

            //Cancel all the subscriptions from db
            const userSubscriptions = await SubscriptionModel.query('userId')
                .eq(user.id)
                .filter('active')
                .eq(true)
                .exec();

            if (userSubscriptions.count > 0) {
                await Promise.all(
                    userSubscriptions.map(async (subscription) => {
                        await SubscriptionModel.update(
                            {
                                id: subscription.id,
                            },
                            {
                                active: false,
                            }
                        );
                    })
                );
            }

            res.json({
                status: 'success',
                message:
                    'Subscription set to cancel at the end of the billing cycle.',
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                status: 'error',
                message: 'Unable to cancel your subscription',
            });
        }
    }
);

//USER PROFILE
app.get('/api/v1/profile', authenticate, async (req, res) => {
    try {
        const profile = await getUserProfile(req.user);

        const profileWithSession = profile;

        if (req?.locals?.sessionToken) {
            profileWithSession.token = req?.locals?.sessionToken;
        }

        res.json({
            status: 'success',
            data: profileWithSession,
        });
    } catch (error) {
        console.error(error);
        res.status(500).send({ error: { message: error.message } });
    }
});

//PRODUCTS
//GENERAL WEB SCRAPING
app.post(
    '/api/v1/scraping',
    authenticate,
    checkCredits,
    dynamicConcurrencyLimiter,
    async (req, res, next) => {
        try {
            res.locals.responseData = {
                status: 'success',
                data: {},
            };
            next();
        } catch (error) {
            res.status(500).send({ error: { message: error.message } });
        }
    },
    deductCredits
);

//DATA extraction
app.post(
    '/api/v1/extraction',
    authenticate,
    checkCredits,
    dynamicConcurrencyLimiter,
    async (req, res) => {
        try {
            res.locals.responseData = {
                status: 'success',
                data: {},
            };
        } catch (error) {
            res.status(500).send({ error: { message: error.message } });
        }
    },
    deductCredits
);

//Screenshots
app.post(
    '/api/v1/screenshots',
    authenticate,
    checkCredits,
    dynamicConcurrencyLimiter,
    async (req, res) => {
        try {
            res.locals.responseData = {
                status: 'success',
                data: {},
            };
        } catch (error) {
            res.status(500).send({ error: { message: error.message } });
        }
    },
    deductCredits
);

app.listen(process.env.PORT, () => {
    console.log(`Server is running on http://localhost:${process.env.PORT}`);
});
