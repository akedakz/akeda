import assert from "node:assert/strict";
import { GRADE2_KEYS, generateGrade2Questions } from "../src/lib/tests/grade2-generators.ts";

function arithmeticAnswer(prompt) {
  let m;
  if ((m = prompt.match(/^(\d+) \+ (\d+) = \?$/))) return +m[1] + +m[2];
  if ((m = prompt.match(/^(\d+) − (\d+) = \?$/))) return +m[1] - +m[2];
  if ((m = prompt.match(/^(\d+) × (\d+) = \?$/))) return +m[1] * +m[2];
  if ((m = prompt.match(/^\((\d+) \+ (\d+)\) − (\d+) = \?$/))) return +m[1] + +m[2] - +m[3];
  if ((m = prompt.match(/^(\d+) − \((\d+) \+ (\d+)\) = \?$/))) return +m[1] - +m[2] - +m[3];
  if ((m = prompt.match(/^(\d+) × \((\d+) \+ (\d+)\) = \?$/))) return +m[1] * (+m[2] + +m[3]);
  if ((m = prompt.match(/^\((\d+) − (\d+)\) × (\d+) = \?$/))) return (+m[1] - +m[2]) * +m[3];
  throw new Error("Unknown task pattern: " + prompt);
}

const iterations = 2_000;
for (const key of GRADE2_KEYS) {
  let total = 0;
  for (let round = 0; round < iterations; round++) {
    const questions = generateGrade2Questions(key);
    assert.equal(questions.length, 16, key + " question count");
    assert.equal(new Set(questions.map((question) => question.prompt)).size, 16, key + " duplicates");
    assert.equal(new Set(questions.map((question) => question.key)).size, 16, key + " duplicate ids");

    const counts = { add: 0, subtract: 0, multiply: 0, parentheses: 0 };
    for (const question of questions) {
      assert.equal(question.answer, arithmeticAnswer(question.prompt), question.prompt);
      assert.ok(Number.isSafeInteger(question.answer) && question.answer >= 0 && question.answer <= 100);
      counts[question.category] += 1;
      total += 1;
    }
    if (key === "grade2_multiplication_v1") assert.equal(counts.multiply, 16);
    if (key === "grade2_addition_v1") assert.equal(counts.add, 16);
    if (key === "grade2_subtraction_v1") assert.equal(counts.subtract, 16);
    if (key === "grade2_mixed_v1") assert.deepEqual(counts, { add: 6, subtract: 5, multiply: 5, parentheses: 0 });
    if (key === "grade2_parentheses_v1") assert.equal(counts.parentheses, 16);
  }
  console.log(key + ": " + total.toLocaleString("en-US") + " questions passed");
}
console.log("All 160,000 generated questions passed independent arithmetic validation.");
