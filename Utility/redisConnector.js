const redis = require('redis');
const dotenv = require('dotenv');

dotenv.config();

const client = redis.createClient({
    socket: {
        host: process.env.REDIS_HOST,
        port: 6379,
        connectTimeout: 80000,
    },
});

client.on('error', (err) =>
    // eslint-disable-next-line no-console
    console.log(
        'Redis Client Error',
        err,
        `Redis host: ${process.env.REDIS_HOST} Redis port: 6379`
    )
);

(async () => {
    await client.connect();
})();

module.exports = client;
