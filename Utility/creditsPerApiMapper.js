exports.getCreditsPerUnitApiRequest = (api) => {
    switch (api) {
        case 'SCRAPING':
            return 1;
        case 'DATA_EXTRACTION':
            return 2;
        case 'SCREENSHOTS':
            return 1;
        default:
            return 1;
    }
};
