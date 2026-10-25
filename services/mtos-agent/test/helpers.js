import { openAgentDb } from '../src/db.js';

export const freshDb = () => openAgentDb(':memory:');

/** A controllable clock starting at a fixed instant. */
export function clock(start = Date.parse('2026-10-25T00:00:00Z')) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  now.set = (ms) => { t = ms; };
  return now;
}

/** Fake AI runner: returns queued outputs (or throws queued errors) in order. */
export function fakeAi(...responses) {
  const calls = [];
  return {
    model: 'fake-model',
    calls,
    loginOkValue: true,
    async run(request) {
      calls.push(request);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return { output: next, runner: 'fake', model: 'fake-model' };
    },
    async loginOk() { return this.loginOkValue; },
  };
}
