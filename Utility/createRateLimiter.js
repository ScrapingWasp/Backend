// eslint-disable-next-line import/no-extraneous-dependencies
const rateLimit = require('express-rate-limit');

/**
 * Creates a rate limiting middleware.
 *
 * @param {number} limit - Number of allowed requests in the time window.
 * @param {number} windowInSeconds - Time window for rate limiting in seconds.
 * @returns {function} Middleware function for Express.
 */
function createRateLimiter(limit, windowInSeconds) {
    return rateLimit({
        windowMs: windowInSeconds * 1000,
        max: limit,
        message: `Too many requests. Please try again later.`,
    });
}

module.exports = createRateLimiter;
