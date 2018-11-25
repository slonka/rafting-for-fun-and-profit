const { trimPort } = require('./peers-utils');

const ipPortToName = {
    '127.0.0.1:8081': 'node1',
    '127.0.0.1:8082': 'node2',
    '127.0.0.1:8083': 'node3',
    '127.0.0.1:8084': 'node4',
    '127.0.0.1:8085': 'node5'
};

const peers = Object.keys(ipPortToName);

for(let ipPort in ipPortToName) {
    ipPortToName[trimPort(ipPort)] = ipPortToName[ipPort];
}

module.exports = {
    peers,
    ipPortToName
}

