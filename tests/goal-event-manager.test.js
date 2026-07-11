const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadGoalEventManagerClass() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
  const start = source.indexOf('class GoalEventManager');
  const end = source.indexOf('\nclass RedCardTracker', start);
  const classSource = source.slice(start, end);

  const context = {
    parseScore(value) {
      const score = Number(value);
      return Number.isInteger(score) && score >= 0 ? score : null;
    },
    normalizeTeamCode(value) {
      return String(value || '').toUpperCase();
    },
    fetch: async () => ({ json: async () => ({}) })
  };

  vm.createContext(context);
  vm.runInContext(classSource + '\nthis.GoalEventManager = GoalEventManager;', context, { filename: 'script.js' });

  return context.GoalEventManager;
}

test('allows score rollback when a goal is disallowed', () => {
  const GoalEventManager = loadGoalEventManagerClass();
  const manager = new GoalEventManager({
    apiUrl: 'https://example.test',
    homeTeam: 'USA',
    awayTeam: 'MEX',
    onGoalConfirmed() {}
  });

  const firstUpdate = manager.updateFromCompetition({
    homeCompetitor: { score: '2', team: { displayName: 'United States' } },
    awayCompetitor: { score: '1', team: { displayName: 'Mexico' } }
  });

  assert.equal(firstUpdate.accepted, true);

  const rollbackUpdate = manager.updateFromCompetition({
    homeCompetitor: { score: '1', team: { displayName: 'United States' } },
    awayCompetitor: { score: '1', team: { displayName: 'Mexico' } }
  });

  assert.equal(rollbackUpdate.accepted, true);
  assert.equal(manager.lastHomeScore, 1);
  assert.equal(manager.lastAwayScore, 1);
});
