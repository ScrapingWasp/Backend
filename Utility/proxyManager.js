const axios = require('axios');
// eslint-disable-next-line import/no-extraneous-dependencies
const { HttpsProxyAgent } = require('https-proxy-agent');

const url = 'https://ip.smartproxy.com/json';

exports.getProxy = async () => {
    const proxyAgent = new HttpsProxyAgent(
        'http://splgc8k729:tuwGvtk6n2b78LPgEy@gate.smartproxy.com:7000'
    );

    try {
        const response = await axios.get(url, {
            httpsAgent: proxyAgent,
        });

        console.log(response.data);
    } catch (error) {
        return null;
    }
};
