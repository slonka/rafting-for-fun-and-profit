const { LocalRaftStateMachine, roles, config } = require('./state-machine');
const assert = require('assert');
const td = require('testdouble');

const initialState = {
    currentTerm: 0,
    lastHeartbeat: null,
    peers: new Set(),
    role: roles.follower,
    nodeId: 'host:port',
    votedFor: null,
    votesGranted: 0,
}

// overwrite config for tests
config.leaderTimeout = 10;
config.leaderTimeoutRandWindow = 3;
config.heartbeatInterval = 8;
config.requestTimeout = 5;

const positiveVote = {voteGranted: true, term: 1};
const negativeVote = {voteGranted: false, term: 1};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getCluster() {
    const machine1 = new LocalRaftStateMachine({nodeId: 'host:port'});
    const machine2 = new LocalRaftStateMachine({nodeId: 'host2:port2'});
    const machine3 = new LocalRaftStateMachine({nodeId: 'host3:port3'});

    machine1.addPeer(machine2);
    machine1.addPeer(machine3);

    machine2.addPeer(machine1);
    machine2.addPeer(machine3);

    machine3.addPeer(machine1);
    machine3.addPeer(machine2);

    return {
        machine1, machine2, machine3
    }
}

describe('state machine', function() {
    it('should start with initial state', function() {
        // given
        const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});

        // when nothing

        // then
        assert.deepEqual(raftStateMachine.state, initialState);
    });

    it('should not transition to leader when can not get majority', async function() {
        // given
        const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});

        // when
        await sleep(35);

        // then
        assert.equal(raftStateMachine.state.role, roles.candidate);
    });

    it('should transition to candidate role when it did not receive a heartbeat', async function() {
        // given
        const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});
        td.replace(raftStateMachine, 'getVotes', td.when(td.function()()).thenResolve([]));
        const prevTerm = raftStateMachine.state.currentTerm;

        // when
        await sleep(15);

        // then
        assert.equal(raftStateMachine.state.role, roles.candidate);
        assert.equal(raftStateMachine.state.currentTerm, prevTerm + 1);
    });

    describe('starting voting', function() {
        it('should transition from candidate to leader when recived majority of votes', async function() {
            // given
            const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});
            raftStateMachine.addPeer(new LocalRaftStateMachine({nodeId: 'host2:port2'}));
            raftStateMachine.addPeer(new LocalRaftStateMachine({nodeId: 'host3:port3'}));
            td.replace(raftStateMachine, 'getVotes', td.when(td.function()()).thenResolve([positiveVote, positiveVote, negativeVote]));
            td.replace(raftStateMachine, 'sendAllHeartbeats', td.function());

            // when
            await raftStateMachine.transitionToCandidate();

            // then
            assert.equal(raftStateMachine.state.role, roles.leader);
            assert.equal(raftStateMachine.state.currentTerm, 2);
        });

        it('should not transition from candidate to leader when recived less than majority of votes', async function() {
            // given
            const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});
            raftStateMachine.addPeer(new LocalRaftStateMachine({nodeId: 'host2:port2'}));
            raftStateMachine.addPeer(new LocalRaftStateMachine({nodeId: 'host3:port3'}));
            td.replace(raftStateMachine, 'getVotes', td.when(td.function()()).thenResolve([positiveVote, negativeVote, negativeVote]));
            td.replace(raftStateMachine, 'sendAllHeartbeats', td.function());

            // when
            await raftStateMachine.transitionToCandidate();

            // then
            assert.equal(raftStateMachine.state.role, roles.candidate);
            assert.equal(raftStateMachine.state.currentTerm, 1);
        });
    });

    it('should send heartbeats when leader', function() {
        // given
        const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});
        const sendAllHeartbeats = td.function();
        td.replace(raftStateMachine, 'sendAllHeartbeats', sendAllHeartbeats);

        // when
        raftStateMachine.transitionToLeader();

        // then
        td.verify(sendAllHeartbeats());
    });

    it('should become follower when it gets heartbeat with higher term', function() {
        // given
        const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});

        // when
        raftStateMachine.receiveHeartbeat({term: 1});

        // then
        assert.equal(raftStateMachine.state.role, roles.follower);
    });

    it('should become candidate when it does not get heartbeat from a leader for a long time', async function() {
        // given
        const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});
        raftStateMachine.addPeer(new LocalRaftStateMachine({nodeId: 'host2:port2'}));
        raftStateMachine.addPeer(new LocalRaftStateMachine({nodeId: 'host3:port3'}));
        td.replace(raftStateMachine, 'getVotes', td.when(td.function()()).thenResolve([positiveVote, negativeVote, negativeVote]));
        td.replace(raftStateMachine, 'sendAllHeartbeats', td.function());

        // when
        await sleep(15);

        // then
        assert.equal(raftStateMachine.state.role, roles.candidate);
    });

    it('should cast a vote when not voted in this term', async function() {
        // given
        const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});

        // when
        const response = raftStateMachine.voteRequested({candidateId: 'host2:port2', term: 1});

        // then
        assert.equal(response.voteGranted, true);
        assert.equal(response.term, 1);
    });

    it('should not cast a vote when voted in this term', async function() {
        // given
        const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});

        // when
        raftStateMachine.voteRequested({candidateId: 'host2:port2', term: 1});
        const response2 = raftStateMachine.voteRequested({candidateId: 'host3:port3', term: 1});

        // then
        assert.equal(response2.voteGranted, false);
        assert.equal(response2.term, 1);
    });

    it('should elect a leader', async function() {
        // given
        const {machine1, machine2, machine3} = getCluster();

        // when
        await sleep(50);
        debugger;

        const leader = [machine1, machine2, machine3].filter(machine => machine.state.role === roles.leader);
        const followers = [machine1, machine2, machine3].filter(machine => machine.state.role === roles.follower);

        // then
        assert.equal(leader.length, 1);
        assert.equal(followers.length, 2);
        assert.equal(leader[0].state.role, roles.leader);
        assert.equal(followers[0].state.role, roles.follower);
        assert.equal(followers[1].state.role, roles.follower);
    });
});