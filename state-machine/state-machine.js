const request = require('request-promise-native');
const { logger } = require('../logger');

const emptyState = {
    currentTerm: 0,
    lastHeartbeat: null,
    role: 'follower',
    nodeId: null,
    votedFor: null,
    votesGranted: 0,
}

const roles = {
    follower: 'follower',
    leader: 'leader',
    candidate: 'candidate',
};

const config = {
    leaderTimeout: 4000,
    heartbeatInterval: 3000,
    requestTimeout: 500,
    leaderTimeoutRandWindow: 100
}

Object.freeze(emptyState);
Object.freeze(roles);

class RaftStateMachine {
    constructor({ nodeId }) {
        if (nodeId == undefined) {
            throw new Error('nodeId and peers must be defined, peers must be an array');
        }

        this.state = { ...emptyState, peers: new Set(), nodeId };
        this.alreadyVotedInThisTerm = false;
        this.resetLeaderTimeout();
    }

    leaderTimedOut() {
        const now = new Date().getTime();
        const diff = Math.abs(now - this.state.lastHeartbeat);
        const result = diff > config.leaderTimeout

        return result;
    }

    addPeer(peer) {
        this.state.peers.add(peer)
    }

    transitionToFollower() {
        this.state.role = roles.follower;
        this.state.votesGranted = null;
        this.resetLeaderTimeout();
        clearTimeout(this.heartbeatTimeout);
    }

    async transitionToCandidate() {
        if (this.leaderTimedOut() && this.state.role !== roles.leader) {
            this.state.role = roles.candidate;
            this.state.currentTerm += 1;
            this.state.alreadyVotedInThisTerm = true;

            const votes = await this.getVotes();
            const positive = this.countPositiveVotes(votes);
            logger.log('received positive votes', positive);
            this.state.votesGranted = positive;

            if (positive > (this.state.peers.size / 2)) {
                clearTimeout(this.leaderTimeout);
                this.transitionToLeader();
            } else {
                this.resetLeaderTimeout();
            }
        }
    }

    async sendAllHeartbeats() {
        if (this.state.role === roles.leader) {
            await Promise.all(Array.from(this.state.peers).map(p => {
                logger.log('sending heartbeat to', p.state.nodeId)
                const heartbeat = { term: this.state.currentTerm };
                return {peer: p, promise: p.sendHeartbeat(heartbeat)};
            }).map(({promise, peer}) => promise.catch(e => {
                logger.error('got error response for heartbeat from', peer);
                return e;
            })));

            this.heartbeatTimeout = setTimeout(this.sendAllHeartbeats.bind(this), config.heartbeatInterval).unref();
        }
    }

    async sendHeartbeat() {
        throw new Error('abstract');
    }

    receiveHeartbeat(message) {
        this.state.lastHeartbeat = new Date().getTime();
        this.resetLeaderTimeout();

        if (message.term >= this.state.currentTerm) {
            this.state.currentTerm = message.term;
            this.state.alreadyVotedInThisTerm = false;
            this.transitionToFollower();
        }
    }

    transitionToLeader() {
        this.state.currentTerm += 1;
        this.state.alreadyVotedInThisTerm = false;
        this.state.role = roles.leader;
        this.sendAllHeartbeats();
    }

    countPositiveVotes(votes) {
      return votes
        .filter(vote => vote.voteGranted === true && vote.term === this.state.currentTerm)
        .length
    }

    resetLeaderTimeout() {
        clearTimeout(this.leaderTimeout);
        this.leaderTimeout = setTimeout(this.transitionToCandidate.bind(this), config.leaderTimeout + (Math.random() * config.leaderTimeoutRandWindow)).unref();
    }

    async getVotes() {
      const responses = Array.from(this.state.peers).map(p => {
          return p.getVote({
              term: this.state.currentTerm,
              candidateId: this.state.nodeId
          });
      });

      return Promise.all(responses);
    }

    async getVote() {
        throw new Error('abstract');
    }

    voteRequested(message) {
        if (message.term > this.state.currentTerm) {
            this.state.currentTerm = message.term;
            this.alreadyVotedInThisTerm = true;
            this.state.votedFor = message.candidateId;
            this.resetLeaderTimeout();
            return {
                voteGranted: true,
                term: message.term
            }
        } else {
            return {
                voteGranted: false,
                term: message.term
            }
        }
    }

    getState() {
        return {
            currentTerm: this.state.currentTerm,
            lastHeartbeat: this.state.lastHeartbeat,
            peers: Array.from(this.state.peers).map(peer => peer.state.nodeId),
            role: this.state.role,
            nodeId: this.state.nodeId,
            votedFor: this.state.votedFor,
            votesGranted: this.state.votesGranted,
        }
    }
}

class LocalRaftStateMachine extends RaftStateMachine {
    constructor(args) {
        super(args);
    }

    async sendHeartbeat(heartbeat) {
        return Promise.resolve(this.receiveHeartbeat(heartbeat));
    }

    async getVote(vote) {
        return Promise.resolve(this.voteRequested(vote));
    }
}

class RemoteRaftStateMachine {
    constructor(nodeId) {
        this.state = {
            nodeId
        };
    }

    async sendHeartbeat(heartbeat) {
        return request.post({
            url: `http://${this.state.nodeId}/raft/append-entries`,
            json: heartbeat,
            timeout: config.requestTimeout,
            resolveWithFullResponse: true
        });
    }

    async getVote(vote) {
      try {
        const response = await request.post({
            url: `http://${this.state.nodeId}/raft/request-vote`,
            json: vote,
            timeout: config.requestTimeout,
            resolveWithFullResponse: true
        });
        return response.body;
      } catch {
        logger.error(`Remote call to ${this.state.nodeId} failed`);
        return {voteGranted: false, term: this.state.currentTerm};
      }
    }
}

module.exports = {
  RaftStateMachine,
  LocalRaftStateMachine,
  RemoteRaftStateMachine,
  roles,
  config,
}