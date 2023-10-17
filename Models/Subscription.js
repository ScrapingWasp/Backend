const dynamoose = require('dynamoose');

const SubscriptionSchema = new dynamoose.Schema(
    {
        id: {
            type: String,
            hashKey: true,
        },
        plan: {
            type: String, //FREELANCE, STARTUP, BUSINESS
            required: true,
            index: {
                global: true,
                name: 'planname-index',
                project: true,
                throughput: 'ON_DEMAND',
            },
        },
        userId: {
            type: String,
            required: true,
            default: 0,
            index: {
                global: true,
                name: 'userid-index',
                project: true,
                throughput: 'ON_DEMAND',
            },
        },
        stripe_subscriptionId: {
            type: String,
            required: true,
            default: 0,
            index: {
                global: true,
                name: 'stripe-subscription-index',
                project: true,
                throughput: 'ON_DEMAND',
            },
        },
        creditsId: {
            type: String,
            required: true,
            index: {
                global: true,
                name: 'creditsid-index',
                project: true,
                throughput: 'ON_DEMAND',
            },
        },
        expirationDate: {
            type: Date,
            required: true,
        },
        active: {
            type: Boolean,
            default: true,
        },
    },
    {
        saveUnknown: false,
        timestamps: true,
    }
);

module.exports = dynamoose.model('Subscription', SubscriptionSchema, {
    throughput: 'ON_DEMAND',
    update: false,
    waitForActive: true,
    initialize: true,
    create: true,
});
