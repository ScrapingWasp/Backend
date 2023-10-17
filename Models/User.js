const dynamoose = require('dynamoose');

const UserSchema = new dynamoose.Schema(
    {
        id: {
            type: String,
            hashKey: true,
        },
        firstname: String,
        lastname: String,
        email: {
            type: String,
            index: {
                global: true,
                name: 'email-index',
                project: true,
                throughput: 'ON_DEMAND',
            },
        },
        password: {
            type: String,
            required: true,
        },
        isVerified: {
            type: Boolean,
            default: false,
        },
        verificationToken: {
            type: String,
            default: null,
        },
    },
    {
        saveUnknown: false,
        timestamps: true,
    }
);

module.exports = dynamoose.model('User', UserSchema, {
    throughput: 'ON_DEMAND',
    update: false,
    waitForActive: true,
    initialize: true,
    create: true,
});
