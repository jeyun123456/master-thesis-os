import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateAgentProjectId, revertAgentProjectIdMigration } from '../src/migrate-project-id.js';
import { createStore } from '../src/store.js';
import { freshDb } from './helpers.js';

const NEW_ID = 'Master_필요노동과_노동력재생산';

test('agent project_id migration is idempotent, keeps content and is reversible', () => {
  const db = freshDb();
  const store = createStore(db);
  const { memo } = store.memos.create({ id: 'm1', kind: 'note', body: '아이디어', project_id: 'thesis' });
  const { milestone } = store.milestones.create({ project_id: 'thesis', title: '초고', date: '2026-11-30', kind: 'internal' });
  store.memos.create({ id: 'm2', kind: 'note', body: '다른', project_id: 'other' });

  assert.deepEqual(migrateAgentProjectId(db, { from: 'thesis', to: NEW_ID }), { dryRun: true, memos: 1, milestones: 1 });
  assert.equal(migrateAgentProjectId(db, { from: 'thesis', to: NEW_ID, apply: true }).memos, 1);
  assert.equal(db.prepare('SELECT project_id, body FROM memos WHERE id = ?').get(memo.id).project_id, NEW_ID);
  assert.equal(db.prepare('SELECT body FROM memos WHERE id = ?').get(memo.id).body, '아이디어');
  assert.equal(db.prepare('SELECT title FROM milestones WHERE id = ?').get(milestone.id).title, '초고');
  assert.equal(db.prepare("SELECT project_id FROM memos WHERE id = 'm2'").get().project_id, 'other');

  const again = migrateAgentProjectId(db, { from: 'thesis', to: NEW_ID, apply: true });
  assert.equal(again.memos + again.milestones, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_id_migrations').get().n, 2);

  assert.equal(revertAgentProjectIdMigration(db, { from: 'thesis', to: NEW_ID }).reverted, 2);
  assert.equal(db.prepare('SELECT project_id FROM memos WHERE id = ?').get(memo.id).project_id, 'thesis');
});
