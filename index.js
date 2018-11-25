const http = require('http');
const _ = require('koa-route');
const Koa = require('koa');
const bodyParser = require('koa-bodyparser');

const { LocalRaftStateMachine, RemoteRaftStateMachine } = require('./state-machine/state-machine');
const { logger } = require('./logger');

const environment = process.env.ENVIRONMENT;

const peersPath = environment === 'test' ? 'peers-test' : 'peers-prod';

const {
    peers,
    ipPortToName
} = require(`./${peersPath}`);

const {
    getPeersWithoutMe,
} = require('./peers-utils');

console.log(`Server pid: ${process.pid}`);

const app = new Koa();
app.use(bodyParser());

const HOST = process.env.HOST;
const PORT = process.env.PORT;
const nodeId = `${HOST}:${PORT}`;
const raftStateMachine = new LocalRaftStateMachine({nodeId});
const peersWithoutMe = getPeersWithoutMe(peers, nodeId);

peersWithoutMe.forEach(peer => raftStateMachine.addPeer(new RemoteRaftStateMachine(peer)));

async function state(ctx) {
    ctx.response.set('Access-Control-Allow-Origin', '*');
    ctx.body = raftStateMachine.getState();
}

function appendEntries(ctx) {
    const messageTerm = parseInt(ctx.request.body.term, 10);
    if (environment !== 'test') {
        logger.log('received heartbeat from', ipPortToName[ctx.ip] || ctx.ip, 'with term', messageTerm);
    } else {
        logger.log('received heartbeat from', ctx.ip, 'with term', messageTerm);
    }

    raftStateMachine.receiveHeartbeat(ctx.request.body);

    ctx.body = {
        term: raftStateMachine.getState().currentTerm,
        "success": true
    }
}

function requestVote(ctx) {
    ctx.body = raftStateMachine.voteRequested(ctx.request.body);
}

app.use(_.get('/raft/state', state));
app.use(_.post('/raft/append-entries', appendEntries));
app.use(_.post('/raft/request-vote', requestVote));

http.createServer(app.callback())
    .listen(PORT, HOST);

console.log(`listening on port http://${HOST}:${PORT}`);
