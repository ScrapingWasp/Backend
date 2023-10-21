const redisClient = require('../Utility/redisConnector');
const subscriptionModel = require('../Models/Subscription');

exports.createDynamicConcurrencyMiddleware = () => async (req, res, next) => {
    const { id: userId } = req.user;

    let subscriptionType = await redisClient.get(`subscription:${userId}`);

    if (!subscriptionType) {
        const subscription = (
            await subscriptionModel.query('userId').eq(userId).exec()
        ).toJSON();

        subscriptionType =
            subscription.length > 0 ? subscription[0].plan : null;

        if (subscriptionType) {
            await redisClient.set(
                `subscription:${userId}`,
                subscriptionType,
                'EX',
                1800
            );
        }
    }

    let maxConcurrency;
    switch (subscriptionType) {
        case 'freelance':
            maxConcurrency = 15;
            break;
        case 'startup':
            maxConcurrency = 150;
            break;
        case 'business':
            maxConcurrency = 250;
            break;
        default:
            maxConcurrency = 5;
            break;
    }

    const currentConcurrency = await redisClient.incr(`concurrency:${userId}`);

    if (currentConcurrency <= maxConcurrency) {
        next();
        res.on('finish', async () => {
            await redisClient.decr(`concurrency:${userId}`);
        });
    } else {
        console.log(
            `Concurrency limit of ${maxConcurrency} requests reached. Consider upgrading your plan`
        );
        await redisClient.decr(`concurrency:${userId}`);
        res.status(429).send(
            `Concurrency limit of ${maxConcurrency} requests reached. Consider upgrading your plan`
        );
    }
};
