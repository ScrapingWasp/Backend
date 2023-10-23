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

exports.deductCredits = async (req, res) => {
    try {
        const { user } = req;
        await deductCredits({
            userId: user.id,
            apiUsed: getAPIUsedNameFromPathname(req.path),
            webpageId: res.locals?.webpageId,
            contentSizeInBytes: res.locals?.webpageSizeInBytes ?? 0,
        });

        res.json(res.locals?.responseData);
    } catch (error) {
        console.error(error.stack);
        res.status(500).send({ error: { message: error.message } });
    }
};
