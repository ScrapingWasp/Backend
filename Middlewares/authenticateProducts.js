// eslint-disable-next-line import/no-extraneous-dependencies
const Cryptr = require('cryptr');
const jwt = require('jsonwebtoken');
const UserModel = require('../Models/User');

const cryptr = new Cryptr(process.env.API_KEYS_GEN_KEY);

const authenticateProducts = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const apiKey = authHeader && authHeader.split(' ')[1];

        if (!apiKey) return res.status(401).send('No API Key found');

        if (!apiKey.startsWith('SW_'))
            return res.status(401).send('Unauthorized');

        const headerSignature = apiKey.split('SW_')[1];

        const user = await UserModel.query('apiKey_headerSignature')
            .eq(headerSignature)
            .exec();

        if (!user || user.count <= 0)
            return res.status(401).send('Unauthorized');

        if (!user[0]?.apiKey) return res.status(401).send('No API Key found.');

        const decodedKeyPackage = jwt.verify(
            user[0].apiKey,
            process.env.JWT_SECRET
        );

        const decryptedApiKey = cryptr.decrypt(decodedKeyPackage.key);

        //Bare test
        if (decryptedApiKey !== user[0]?.apiKey_bare) {
            console.log('Failed bare test');
            return res.status(401).send('Unauthorized');
        }

        req.user = user[0];

        next();
    } catch (error) {
        console.error('Internal server error:', error);
        res.status(500).send('Internal Server Error');
    }
};

module.exports = authenticateProducts;
