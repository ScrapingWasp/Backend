const getBytesToCreditsRate = (bytes) => bytes * (12.0637 * 10 ** -5);

exports.getCreditsPerUnitApiRequest = (contentSizeInBytes) =>
    getBytesToCreditsRate(contentSizeInBytes);
