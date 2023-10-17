const dynamoose = require('dynamoose');

const CreditUsageSchema = new dynamoose.Schema(
    {
        id: {
            type: String,
            hashKey: true,
        },
        userId: {
            type: String,
            required: true,
            index: {
                global: true,
                name: 'user-index',
                project: true,
                throughput: 'ON_DEMAND',
            },
        },
        credits: {
            type: Number,
            required: true,
        },
        apiUsed: {
            type: String,
            required: true, //SCRAPING, DATA_EXTRACTION, SCREENSHOTS
        },
    },
    {
        saveUnknown: false,
        timestamps: true,
    }
);

module.exports = dynamoose.model('CreditUsage', CreditUsageSchema, {
    throughput: 'ON_DEMAND',
    update: false,
    waitForActive: true,
    initialize: true,
    create: true,
});
