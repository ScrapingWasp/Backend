const dynamoose = require('dynamoose');

const WebpageSchema = new dynamoose.Schema(
    {
        id: {
            type: String,
            hashKey: true,
        },
        pageSizeBytes: {
            type: Number,
            default: 0,
        },
        flag: {
            type: String,
            required: true,
            default: 'USER_REQUEST', //USER_REQUEST, AUTOMATED_REQUEST
            index: {
                global: true,
                name: 'flag-index',
                project: true,
                throughput: 'ON_DEMAND',
            },
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
        title: {
            type: String,
        },
        url: {
            type: String,
            index: {
                global: true,
                name: 'url-index',
                project: true,
                throughput: 'ON_DEMAND',
            },
        },
        description: {
            type: String,
        },
        content_uri: {
            type: String,
        },
        structured_content_uri: {
            type: String,
        },
        state: {
            type: String,
            required: true,
            default: 'PENDING', //PENDING, IN_PROGRESS, COMPLETED, FAILED
            index: {
                global: true,
                name: 'state-index',
                project: true,
                throughput: 'ON_DEMAND',
            },
        },
        used_creditId: {
            type: String,
            index: {
                global: true,
                name: 'credit-index',
                project: true,
                throughput: 'ON_DEMAND',
            },
        },
    },
    {
        saveUnknown: false,
        timestamps: true,
    }
);

module.exports = dynamoose.model('Webpage', WebpageSchema, {
    throughput: 'ON_DEMAND',
    update: true,
    waitForActive: true,
    initialize: true,
    create: true,
});
