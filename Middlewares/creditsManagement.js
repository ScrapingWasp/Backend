const {
    getUserCurrentBalance,
    deductCredits,
    getAPIUsedNameFromPathname,
} = require('../Utility/utils');

exports.checkCredits = async (req, res, next) => {
    const { user } = req;

    const balance = await getUserCurrentBalance(user.id);

    if (balance.credits > 0) {
        next();
    } else {
        res.status(403).send('Insufficient credits');
    }
};

exports.deductCredits = async (req, res, next) => {
    try {
        const { user } = req;

        await deductCredits({
            userId: user.id,
            apiUsed: getAPIUsedNameFromPathname(req.path),
        });
        next();
    } catch (error) {
        console.error(error.stack);
        next();
    }
};
