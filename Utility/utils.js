const AWS = require('aws-sdk');
const crypto = require('crypto');
// eslint-disable-next-line import/no-extraneous-dependencies
const { generateApiKey } = require('generate-api-key');
const { v4: uuidv4 } = require('uuid');
const userModel = require('../Models/User');

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
                process.env.API_KEYS_GEN_KEY
            )
            .update(key, 'utf8', 'hex');

        //...Update the user
        await userModel.update({ id: userId }, { apiKey: encryptedApiKey });
    } catch (error) {
        console.error(error.stack);
    }
};
