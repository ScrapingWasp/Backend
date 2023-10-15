const dynamoose = require('dynamoose');

const WebpageSchema = new dynamoose.Schema(
    {
        id: {
            type: String,
            hashKey: true,
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
    },
    {
        saveUnknown: false,
        timestamps: true,
    }
);

module.exports = dynamoose.model('Webpage', WebpageSchema, {
    throughput: 'ON_DEMAND',
    update: false,
    waitForActive: true,
    initialize: true,
    create: true,
});
