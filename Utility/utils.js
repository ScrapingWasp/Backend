/* eslint-disable no-else-return */
const AWS = require('aws-sdk');
const crypto = require('crypto');
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
            max: 25,
            min: 25,
            prefix: 'sw',
        });

        const encryptedApiKey = crypto
            .createCipheriv(
                process.env.API_KEYS_ENCRYPTION_ALGORITHM,
                Buffer.from(process.env.API_KEYS_GEN_KEY, 'hex'),
                Buffer.from(process.env.API_KEYS_ENCRYPTION_IV, 'hex')
            )
            .update(key, 'utf8', 'hex');

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
        isVerified: userData.isVerified,
        email: userData.email,
        apiKey: userData.apiKey,
        balance,
    };

    return userProfile;
};
