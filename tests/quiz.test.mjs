import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QUESTIONS, normalizeQuestions } from '../quiz.mjs';

test('question bank accepts and trims four-choice questions', () => {
  const result = normalizeQuestions([{ question: '  2 + 2? ', options: [' 3 ', ' 4 ', ' 5 ', ' 6 '], answer: 1 }]);
  assert.deepEqual(result, [{ question: '2 + 2?', options: ['3', '4', '5', '6'], answer: 1 }]);
  assert.ok(normalizeQuestions(DEFAULT_QUESTIONS).length > 0);
});

test('question bank rejects incomplete or oversized exams', () => {
  assert.throws(() => normalizeQuestions([{ question: 'A?', options: ['a', 'b', 'c', ''], answer: 0 }]));
  assert.throws(() => normalizeQuestions([{ question: 'A?', options: ['a', 'b', 'c', 'd'], answer: 4 }]));
  assert.throws(() => normalizeQuestions(Array(21).fill(DEFAULT_QUESTIONS[0])));
});
