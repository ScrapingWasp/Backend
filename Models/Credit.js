const dynamoose = require('dynamoose');

const CreditSchema = new dynamoose.Schema(
    {
        id: {
            type: String,
            hashKey: true,
        },
        flag: {
            type: String,
            required: true, //SIGNUP_CREDIT, SUBCRIPTION_CREDIT, TOPUP_CREDIT
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
        amount: {
            type: Number,
            required: true,
            default: 0,
            index: {
                global: true,
                name: 'amount-index',
                project: true,
                throughput: 'ON_DEMAND',
            },
        },
        credits: {
            type: Number,
            required: true,
        },
        expirationDate: {
            type: Date,
            required: true,
        },
    },
    {
        saveUnknown: false,
        timestamps: true,
    }
);

module.exports = dynamoose.model('Credit', CreditSchema, {
    throughput: 'ON_DEMAND',
    update: false,
    waitForActive: true,
    initialize: true,
    create: true,
});
