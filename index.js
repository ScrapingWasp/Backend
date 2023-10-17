/* eslint-disable no-lonely-if */
const dotenv = require('dotenv');
// eslint-disable-next-line import/no-extraneous-dependencies
const jwt = require('jsonwebtoken');
// eslint-disable-next-line import/no-extraneous-dependencies
const bcrypt = require('bcrypt');
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
const UserModel = require('./Models/User');

const {
    saveToS3,
    cleanCachedString,
    getPageDescription,
    generateAPIKey,
} = require('./Utility/utils');
const sendEmail = require('./Utility/sendEmail');
const createRateLimiter = require('./Utility/createRateLimiter');
const authenticate = require('./Middlewares/authenticate');

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

//USERS
app.post('/api/v1/signup', createRateLimiter(50, 60 * 15), async (req, res) => {
    try {
        const { firstname, lastname, email, password } = req.body;

        const standardEmail = email.toLowerCase().trim();
        //Check if the account is unique
        const previousAccount = await UserModel.query('email')
            .eq(standardEmail)
            .exec();

        if (previousAccount.count <= 0) {
            //New account
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            const verificationToken = uuidv4();

            const userId = uuidv4();

            const newAccount = await UserModel.create({
                id: userId,
                firstname,
                lastname,
                email,
                password: hashedPassword,
                verificationToken,
            });

            //? Generate API key
            await generateAPIKey(userId);

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
                    const account = accountHolder.toJSON()[0];
                    delete account.password;
                    delete account.isVerified;
                    delete account.verificationToken;

                    const newToken = jwt.sign(
                        { user_id: accountHolder[0]?.id },
                        process.env.JWT_SECRET,
                        { expiresIn: '2h' }
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

                    res.cookie('token', newToken, { httpOnly: true }).json({
                        status: 'success',
                        data: account,
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
app.get('/api/v1/apikey', authenticate, async (req, res) => {
    try {
        const user = req.user.id;

        const decryptedApiKey = crypto
            .createDecipher(
                process.env.API_KEYS_ENCRYPTION_ALGORITHM,
                process.env.API_KEYS_GEN_KEY
            )
            .update(user.apiKey, 'hex', 'utf8');

        res.json({
            status: 'success',
            data: decryptedApiKey,
        });
    } catch (error) {
        res.status(500).send({ error: { message: error.message } });
    }
});

app.get('/api/v1/apikey/regenerate', authenticate, async (req, res) => {
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

        console.log(prices);

        res.send({
            status: 'success',
            data: filteredPrices,
        });
    } catch (err) {
        res.status(500).send({ error: { message: err.message } });
    }
});

app.post('/subscription', authenticate, async (req, res) => {
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

app.listen(process.env.PORT, () => {
    console.log(`Server is running on http://localhost:${process.env.PORT}`);
});
