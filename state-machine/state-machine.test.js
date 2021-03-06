'use strict';

jest.useFakeTimers();

const { LocalRaftStateMachine, roles, config } = require('./state-machine');
const assert = require('assert');
const td = require('testdouble');

const { logger } = require('../logger');

logger.log = () => {};
logger.error = () => {};

const initialState = {
    currentTerm: 0,
    lastHeartbeat: null,
    peers: new Set(),
    role: roles.follower,
    nodeId: 'host:port',
    votedFor: null,
    votesGranted: 0,
}

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

function getStateMachineWithPeers() {
    const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});
    raftStateMachine.addPeer(new LocalRaftStateMachine({nodeId: 'host2:port2'}));
    raftStateMachine.addPeer(new LocalRaftStateMachine({nodeId: 'host3:port3'}));

    return raftStateMachine;
}

test('should start with initial state', function() {
    // given
    const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});

    // when nothing

    // then
    assert.deepEqual(raftStateMachine.state, initialState);
});

test('should not transition to leader when can not get majority', async function() {
    // given
    const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});

    // when
    jest.runOnlyPendingTimers();

    // then
    assert.equal(raftStateMachine.state.role, roles.candidate);
});

test('should transition to candidate role when it did not receive a heartbeat', async function() {
    // given
    const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});
    td.replace(raftStateMachine, 'getVotes', td.when(td.function()()).thenResolve([]));
    const prevTerm = raftStateMachine.state.currentTerm;

    // when
    jest.runOnlyPendingTimers();

    // then
    assert.equal(raftStateMachine.state.role, roles.candidate);
    assert.equal(raftStateMachine.state.currentTerm, prevTerm + 1);
});

test('should transition from candidate to leader when received majority of votes', async function() {
    // given
    const raftStateMachine = getStateMachineWithPeers();

    td.replace(raftStateMachine, 'getVotes', td.when(td.function()()).thenResolve([positiveVote, positiveVote, negativeVote]));
    td.replace(raftStateMachine, 'sendAllHeartbeats', td.function());

    // when
    await raftStateMachine.transitionToCandidate();

    // then
    assert.equal(raftStateMachine.state.role, roles.leader);
    assert.equal(raftStateMachine.state.currentTerm, 2);
});

test('should not transition from candidate to leader when received less than majority of votes', async function() {
    // given
    const raftStateMachine = getStateMachineWithPeers();
    td.replace(raftStateMachine, 'getVotes', td.when(td.function()()).thenResolve([positiveVote, negativeVote, negativeVote]));
    td.replace(raftStateMachine, 'sendAllHeartbeats', td.function());

    // when
    await raftStateMachine.transitionToCandidate();

    // then
    assert.equal(raftStateMachine.state.role, roles.candidate);
    assert.equal(raftStateMachine.state.currentTerm, 1);
});

test('should send heartbeats when leader', function() {
    // given
    const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});
    const sendAllHeartbeats = td.function();
    td.replace(raftStateMachine, 'sendAllHeartbeats', sendAllHeartbeats);

    // when
    raftStateMachine.transitionToLeader();

    // then
    td.verify(sendAllHeartbeats());
});

test('should become follower when it gets heartbeat with higher term', function() {
    // given
    const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});

    // when
    raftStateMachine.receiveHeartbeat({term: 1});

    // then
    assert.equal(raftStateMachine.state.role, roles.follower);
});

test('should become candidate when it does not get heartbeat from a leader for a long time', async function() {
    // given
    const raftStateMachine = getStateMachineWithPeers();
    td.replace(raftStateMachine, 'getVotes', td.when(td.function()()).thenResolve([positiveVote, negativeVote, negativeVote]));
    td.replace(raftStateMachine, 'sendAllHeartbeats', td.function());

    // when
    jest.runOnlyPendingTimers();

    // then
    assert.equal(raftStateMachine.state.role, roles.candidate);
});

test('should start a second voting when first vote is unsuccessful', async function() {
    // given
    const raftStateMachine = getStateMachineWithPeers();
    td.replace(raftStateMachine, 'getVotes', td.when(td.function()()).thenResolve([positiveVote, negativeVote, negativeVote]));
    td.replace(raftStateMachine, 'sendAllHeartbeats', td.function());

    // when
    raftStateMachine.transitionToCandidate();
    jest.runOnlyPendingTimers();

    // then
    assert.equal(raftStateMachine.state.role, roles.candidate);
    assert.equal(raftStateMachine.state.currentTerm, 2);
});

test('should cast a vote when not voted in this term', async function() {
    // given
    const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});

    // when
    const response = raftStateMachine.voteRequested({candidateId: 'host2:port2', term: 1});

    // then
    assert.equal(response.voteGranted, true);
    assert.equal(response.term, 1);
});

test('should not cast a vote when voted in this term', async function() {
    // given
    const raftStateMachine = new LocalRaftStateMachine({nodeId: 'host:port'});

    // when
    raftStateMachine.voteRequested({candidateId: 'host2:port2', term: 1});
    const response2 = raftStateMachine.voteRequested({candidateId: 'host3:port3', term: 1});

    // then
    assert.equal(response2.voteGranted, false);
    assert.equal(response2.term, 1);
});

test('should elect a leader', async function() {
    // given
    const {machine1, machine2, machine3} = getCluster();

    // when
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    await advanceMicroTasks();

    const leader = [machine1, machine2, machine3].filter(machine => machine.state.role === roles.leader);
    const followers = [machine1, machine2, machine3].filter(machine => machine.state.role === roles.follower);

    // then
    assert.equal(leader.length, 1);
    assert.equal(followers.length, 2);
    assert.equal(leader[0].state.role, roles.leader);
    assert.equal(followers[0].state.role, roles.follower);
    assert.equal(followers[1].state.role, roles.follower);
});

async function advanceMicroTasks() {
    await sleep(1);
}