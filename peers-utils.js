const getPeersWithoutMe = (peers, nodeId) => peers.filter(p => p !== nodeId);

const trimPort = ip => ip.split(':')[0];

module.exports = {
    getPeersWithoutMe,
    trimPort
}