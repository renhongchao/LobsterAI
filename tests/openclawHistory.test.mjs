import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  extractGatewayMessageText,
  extractGatewayHistoryEntry,
  extractGatewayHistoryEntries,
  buildScheduledReminderSystemMessage,
} = require('../dist-electron/main/libs/openclawHistory.js');

test('extractGatewayMessageText joins text content blocks', () => {
  const text = extractGatewayMessageText({
    content: [
      { type: 'text', text: 'First line' },
      { type: 'toolCall', name: 'cron', arguments: { action: 'add' } },
      { type: 'text', text: 'Second line' },
    ],
  });

  assert.equal(text, 'First line\nSecond line');
});

test('extractGatewayHistoryEntry keeps system messages', () => {
  const entry = extractGatewayHistoryEntry({
    role: 'system',
    content: [
      { type: 'text', text: 'Reminder fired' },
    ],
  });

  assert.deepEqual(entry, {
    role: 'system',
    text: 'Reminder fired',
  });
});

test('extractGatewayHistoryEntries filters unsupported roles and empty messages', () => {
  const entries = extractGatewayHistoryEntries([
    { role: 'user', content: 'Set a reminder' },
    { role: 'system', content: [{ type: 'text', text: 'Reminder fired' }] },
    { role: 'tool', content: 'ignored' },
    { role: 'assistant', content: [{ type: 'toolCall', name: 'cron', arguments: {} }] },
    { role: 'assistant', content: 'Done' },
  ]);

  assert.deepEqual(entries, [
    { role: 'user', text: 'Set a reminder' },
    { role: 'system', text: 'Reminder fired' },
    { role: 'assistant', text: 'Done' },
  ]);
});

test('extractGatewayHistoryEntry remaps scheduled reminder prompts to system messages', () => {
  const entry = extractGatewayHistoryEntry({
    role: 'user',
    content: `A scheduled reminder has been triggered. The reminder content is:

⏰ 提醒：该去买菜了！

Handle this reminder internally. Do not relay it to the user unless explicitly requested.
Current time: Sunday, March 15th, 2026 — 11:27 (Asia/Shanghai)`,
  });

  assert.equal(entry?.role, 'system');
  assert.match(entry?.text ?? '', /^System: \[Sunday, March 15th, 2026 — 11:27 \(Asia\/Shanghai\)\] ⏰ 提醒：该去买菜了！/);
  assert.match(entry?.text ?? '', /Please relay this reminder to the user in a helpful and friendly way\./);
});

test('buildScheduledReminderSystemMessage returns null for regular user text', () => {
  assert.equal(buildScheduledReminderSystemMessage('普通聊天消息'), null);
});
