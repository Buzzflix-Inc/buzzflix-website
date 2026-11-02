// Tests for the Buzz Run leaderboard API (worker/leaderboard.js). Run: node --test scripts/test-leaderboard.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {leaderboard, memoryStore} from '../worker/leaderboard.js';

globalThis.crypto ??= webcrypto;
const call = async (store, method, path, body, now) => {
  const response = await leaderboard(new Request(`https://buzzflix.ca${path}`, {method, body: body && JSON.stringify(body)}), store, now);
  return {status: response.status, body: await response.json()};
};
const start = async (store, now = 0) => (await call(store, 'POST', '/api/buzz-run/runs', null, now)).body.run;
const post = (store, body, now) => call(store, 'POST', '/api/buzz-run/scores', body, now);

test('a played run is saved and ranked', async () => {
  const store = memoryStore();
  const run = await start(store);
  const {status, body} = await post(store, {run, name: 'jok', score: 12}, 12 * 1000);
  assert.equal(status, 200);
  assert.deepEqual(body, {scores: [{name: 'JOK', score: 12}], rank: 1});
  assert.deepEqual((await call(store, 'GET', '/api/buzz-run/scores')).body, {scores: [{name: 'JOK', score: 12}]});
});

test('keeps the top 10, earlier score first on a tie', async () => {
  const store = memoryStore();
  for (let i = 1; i <= 11; i++) await post(store, {run: await start(store), name: 'AAA', score: i}, 60_000);
  const tie = await post(store, {run: await start(store), name: 'BBB', score: 11}, 61_000);
  assert.equal(tie.body.scores.length, 10);
  assert.deepEqual(tie.body.scores.slice(0, 2), [{name: 'AAA', score: 11}, {name: 'BBB', score: 11}]);
  assert.equal(tie.body.rank, 2);
  const low = await post(store, {run: await start(store), name: 'CCC', score: 1}, 61_000);
  assert.equal(low.body.rank, null);
});

test('rejects scores faster than the game allows, reused or unknown runs', async () => {
  const store = memoryStore();
  assert.equal((await post(store, {run: await start(store), name: 'AAA', score: 50}, 5000)).status, 400);
  const run = await start(store);
  assert.equal((await post(store, {run, name: 'AAA', score: 5}, 5000)).status, 200);
  assert.equal((await post(store, {run, name: 'AAA', score: 5}, 6000)).status, 400);
  assert.equal((await post(store, {run: 'made-up', name: 'AAA', score: 1}, 6000)).status, 400);
});

test('rejects bad initials and scores', async () => {
  const store = memoryStore();
  for (const [name, score] of [['AB', 3], ['A1B', 3], ['kkk', 3], ['ABC', 0], ['ABC', 2.5], ['ABC', '3']]) {
    assert.equal((await post(store, {run: await start(store), name, score}, 60_000)).status, 400, `${name} ${score}`);
  }
  assert.equal((await call(store, 'POST', '/api/buzz-run/scores', null)).status, 400);
  assert.equal((await call(store, 'DELETE', '/api/buzz-run/scores')).status, 405);
});
