/* eslint-disable no-else-return */
const AWS = require('aws-sdk');
// eslint-disable-next-line import/no-extraneous-dependencies
const Cryptr = require('cryptr');
// eslint-disable-next-line import/no-extraneous-dependencies
const { generateApiKey } = require('generate-api-key');
const { v4: uuidv4 } = require('uuid');
const userModel = require('../Models/User');
const creditModel = require('../Models/Credit');
const creditUsageModel = require('../Models/CreditUsage');
const subscriptionModel = require('../Models/Subscription');
const { getCreditsPerUnitApiRequest } = require('./creditsPerApiMapper');

const s3 = new AWS.S3(
    process.env.ENV === 'dev'
        ? {
              s3ForcePathStyle: true,
              accessKeyId: 'YOUR-ACCESSKEYID',
              secretAccessKey: 'YOUR-SECRETACCESSKEY',
              endpoint: new AWS.Endpoint('http://localhost:4566'),
              sslEnabled: false,
              region: process.env.AWS_REGION,
          }
        : {
              s3ForcePathStyle: true,
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
              region: process.env.AWS_REGION,
          }
);

exports.saveToS3 = async (bucketName, data) => {
    const s3Key = `${uuidv4()}.txt`;
    const s3params = {
        Bucket: bucketName, // Replace with your S3 bucket name
        Key: s3Key,
        Body: data,
        ContentType: 'text/plain',
    };
    await s3.putObject(s3params).promise();

    // Generate S3 URI
    const s3Uri = `s3://webpages-blob/${s3Key}`;

    return s3Uri;
};

exports.cleanCachedString = (data) => data.replace(/\\(['"])/g, '$1');

exports.getPageDescription = async (page) => {
    try {
        return await page.$eval(
            'meta[name="description"]',
            (element) => element.content
        );
    } catch (error) {
        return 'None';
    }
};

exports.generateAPIKey = async (userId) => {
    try {
        const key = generateApiKey({
            method: 'string',
            pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_',
            max: 64,
            min: 64,
            prefix: 'SW',
        });

        const cryptr = new Cryptr(process.env.API_KEYS_GEN_KEY);

        const encryptedApiKey = cryptr.encrypt(key);

        //...Update the user
        await userModel.update({ id: userId }, { apiKey: encryptedApiKey });
    } catch (error) {
        console.error(error.stack);
    }
};

exports.giveFreeFirstTimeSignupCredits = async (userId) => {
    try {
        //Check if the user already received the free credits
        const signupCredit = await creditModel
            .query('userId')
            .eq(userId)
            .filter('amount')
            .eq(0)
            .filter('flag')
            .eq('SIGNUP_CREDIT')
            .exec();

        if (signupCredit.count <= 0) {
            //Not received yet
            const signupCreditId = uuidv4();
            const signupCreditExpirationDate = new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000
            ); //30 days from now

            await creditModel.create({
                id: signupCreditId,
                flag: 'SIGNUP_CREDIT',
                userId,
                amount: 0,
                credits: parseInt(process.env.DEFAULT_SIGNUP_CREDITS, 10),
                expirationDate: signupCreditExpirationDate,
            });
        } else {
            console.log('Sign up credits was already given to the user');
        }
    } catch (error) {
        console.error(error.stack);
    }
};

exports.getUserCurrentBalance = async (userId) => {
    try {
        const currentCredits = await creditModel
            .query('userId')
            .eq(userId)
            .filter('expirationDate')
            .gt(Date.now())
            .exec();

        if (currentCredits.count > 0) {
            let subscription = await subscriptionModel
                .query('userId')
                .eq(userId)
                .filter('active')
                .eq(true)
                .exec();

            if (subscription.count > 0) {
                subscription = subscription.toJSON()[0];
                subscription = {
                    plan: subscription.plan,
                    createAt: new Date(subscription?.createdAt).toISOString(),
                    expirationDate: new Date(
                        subscription.expirationDate
                    ).toISOString(),
                    active: subscription.active,
                };
            } else {
                subscription = {};
            }

            //No credits
            const credits = currentCredits
                .toJSON()
                .reduce((acc, curr) => acc + curr.credits, 0);

            const usedCredits = (
                await creditUsageModel.query('userId').eq(userId).exec()
            )
                .toJSON()
                .reduce((acc, curr) => acc + curr.credits, 0);

            const remainingCredits = credits - usedCredits;

            return {
                credits: remainingCredits,
                usedCredits,
                status: 'available',
                subscription,
                expiration: 'next_billing_cycle',
            };
        }
        return {
            credits: 0,
            usedCredits: 0,
            status: 'no credits',
            expiration: null,
        };
    } catch (error) {
        console.error(error.stack);
        return {
            credits: 0,
            usedCredits: 0,
            status: 'unavailable',
            expiration: null,
        };
    }
};

exports.deductCredits = async ({ userId, apiUsed, queryTime = 0 }) => {
    try {
        const creditsUsed = getCreditsPerUnitApiRequest(apiUsed);

        const creditUsageId = uuidv4();

        const userBalance = await exports.getUserCurrentBalance(userId);

        if (
            userBalance?.credits === 0 &&
            (userBalance?.usedCredits ?? 0) + creditsUsed >
                (userBalance?.credits ?? 0)
        )
            return;

        await creditUsageModel.create({
            id: creditUsageId,
            userId,
            credits: creditsUsed,
            apiUsed,
        });
    } catch (error) {
        console.error(error);
    }
};

exports.getAPIUsedNameFromPathname = (path) => {
    if (/scraping/.test(path)) {
        return 'SCRAPING';
    } else if (/extraction/.test(path)) {
        return 'DATA_EXTRACTION';
    } else if (/screenshot/.test(path)) {
        return 'SCREENSHOTS';
    } else {
        return 'SCRAPING';
    }
};

exports.getUserProfile = async (user) => {
    const userData = user;
    const balance = await exports.getUserCurrentBalance(user.id);

    const userProfile = {
        id: userData.id,
        firstName: userData.firstname,
        lastName: userData.lastname,
        customerId: userData.stripe_customerId,
        isVerified: userData.isVerified,
        email: userData.email,
        balance,
    };

    console.log(userProfile);

    return userProfile;
};

const planNameToCreditsMap = (plan) => {
    switch (plan) {
        case 'FREELANCE':
            return 250000;
        case 'STARTUP':
            return 1500000;
        case 'BUSINESS':
            return 4000000;
        default:
            return 0;
    }
};

exports.updateSubscription = async (eventObject, stripe) => {
    const plan = eventObject.items.data[0].price.lookup_key;
    const customerId = eventObject.customer;
    // eslint-disable-next-line prefer-destructuring
    const status = eventObject.status;
    const userData = (
        await userModel.query('stripe_customerId').eq(customerId).exec()
    )[0];

    if (status === 'active') {
        console.log('Active subscription detected');
        //! Check if there is an active subscription already
        const previousSubscription = await subscriptionModel
            .query('userId')
            .eq(userData.id)
            .filter('active')
            .eq(true)
            .exec();

        let isSameSubscription = false;

        if (previousSubscription.count > 0) {
            //Has an old active subscription
            const oldSubscription = previousSubscription.toJSON()[0];

            if (oldSubscription.stripe_subscriptionId !== eventObject.id) {
                //Cancel from stripe
                await stripe.subscriptions.cancel(
                    oldSubscription.stripe_subscriptionId
                );
                //The old subscription is not the same as the new one
                //Mark the old as inactive
                await subscriptionModel.update(
                    { id: oldSubscription.id },
                    { active: false }
                );
                isSameSubscription = false;
            } else {
                isSameSubscription = true;
            }
        }

        const formattedPlanName = plan.toUpperCase().trim();
        const credits = planNameToCreditsMap(formattedPlanName);
        const effectiveDate = Date.now() + 30 * 24 * 60 * 60 * 1000;

        const createdCredits = await creditModel.create({
            id: uuidv4(),
            flag: 'SUBSCRIPTION',
            userId: userData.id,
            amount: eventObject.plan.amount / 100,
            credits,
            expirationDate: effectiveDate,
        });

        //Create new user credits based on the current plan
        //Create the new subscription record
        let updatedSubscription;

        if (!isSameSubscription) {
            updatedSubscription = await subscriptionModel.create({
                id: uuidv4(),
                plan: formattedPlanName,
                userId: userData.id,
                stripe_subscriptionId: eventObject.id,
                creditsId: createdCredits.id,
                expirationDate: effectiveDate,
                active: true,
            });
        } //Just update the current record
        else {
            updatedSubscription = await subscriptionModel.update(
                { id: previousSubscription.toJSON()[0].id },
                {
                    expirationDate: effectiveDate,
                    creditsId: createdCredits.id,
                    plan: formattedPlanName,
                }
            );
        }

        //! Make sure all the subscriptions except the created/updated are not active
        const allSubscriptions = await subscriptionModel
            .query('userId')
            .eq(userData.id)
            .exec();

        await Promise.all(
            allSubscriptions.toJSON().map(async (subscription) => {
                if (subscription.id !== updatedSubscription.id) {
                    await subscriptionModel.update(
                        { id: subscription.id },
                        { active: false }
                    );
                }
            })
        );

        //Update the all the credits that are not yet expired
        const currentCredits = await creditModel
            .query('userId')
            .eq(userData.id)
            .filter('expirationDate')
            .gt(Date.now())
            .exec();

        console.log(currentCredits);

        await Promise.all(
            currentCredits.toJSON().map(async (credit) => {
                await creditModel.update(
                    { id: credit.id },
                    { expirationDate: effectiveDate }
                );
            })
        );

        return updatedSubscription;
    }
};
