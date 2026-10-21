const assert = require('node:assert/strict');
const { test } = require('node:test');
const personality = require('../modules/personality');
const { selectPersonalityContext } = require('../modules/personality-context');
const { purchaseSchema, updatePurchaseSurvey, formatPurchaseAdvice } = require('../modules/project-purchase');

for (const [content, previousTopics, expected] of [
  ['Co myślisz o Star Citizen?', [], ['project']],
  ['Czy warto kupić SC?', [], ['project']],
  ['Lubisz Chrisa Robertsa?', [], ['project']],
  ['Co sądzisz o Jaredzie Huckabym?', [], ['project']],
  ['Disco Lando!', [], ['project']],
  ['Jak oceniasz finansowanie CIG?', [], ['project']],
  ['Co z roadmapą?', [], ['project']],
  ['1. tak, 2. nie, 3. tak', ['project'], ['project']],
  ['Tak.', ['project'], ['project']],
  ['Jestem programistą i fanem SF.', ['project'], ['project']],
  ['Tylko tyle?', ['project'], ['project']],
  ['Czy kupić Cuttera?', [], ['ships']],
  ['Jaka jest twoja ulubiona broń?', ['project'], ['weapons']],
  ['Jaką muzykę lubisz?', ['project'], ['music']],
  ['Cześć!', ['project'], []],
]) {
  test(`Projekt: ${content}`, () => {
    const selected = selectPersonalityContext({ content, previousTopics, contextModules: personality.contextModules });
    assert.deepEqual(selected.topics, expected);
    assert.equal(selected.instructions.includes(personality.projectInfo), expected.includes('project'));
  });
}

test('Stanowisko projektu nie powiększa stałego promptu', () => {
  assert.ok(!personality.basePrompt.includes(personality.projectInfo));
  assert.equal(personality.basePrompt.length, 8970);
});

test('Wszystkie osiem kombinacji: co najmniej dwa tak oznaczają rekomendację', () => {
  const keys = ['scienceFiction', 'acceptsRisk', 'followsDevelopment'];
  for (let mask = 0; mask < 8; mask++) {
    const answers = Object.fromEntries(keys.map((key, index) => [key, mask & (1 << index) ? 'yes' : 'no']));
    const yes = Object.values(answers).filter(v => v === 'yes').length;
    const survey = updatePurchaseSurvey({ intent: true, answers });
    assert.equal(survey.verdict, yes >= 2 ? 'yes' : 'no');
  }
});

test('Brak odpowiedzi i jedna pozytywna odpowiedź pozostawiają domyślne nie', () => {
  let survey = updatePurchaseSurvey({ intent: true, answers: {} });
  assert.equal(survey.verdict, 'pending');
  assert.match(formatPurchaseAdvice(survey), /Na razie nie/);
  survey = updatePurchaseSurvey({ previous: survey, intent: false, answers: { scienceFiction: 'yes' } });
  assert.equal(survey.verdict, 'pending');
  assert.doesNotMatch(formatPurchaseAdvice(survey), /1\. Czy/);
  survey = updatePurchaseSurvey({ previous: survey, intent: false, answers: { followsDevelopment: 'yes' } });
  assert.equal(survey.verdict, 'yes');
  assert.match(formatPurchaseAdvice(survey), /nieukończony projekt/);
});

test('Unknown nie kasuje odpowiedzi; jawna zmiana odpowiedzi zmienia werdykt', () => {
  const previous = updatePurchaseSurvey({ intent: true, answers: { scienceFiction: 'yes', acceptsRisk: 'yes' } });
  const unchanged = updatePurchaseSurvey({ previous, intent: false, answers: { scienceFiction: 'unknown' } });
  assert.equal(unchanged.verdict, 'yes');
  const changed = updatePurchaseSurvey({ previous, intent: false, answers: { scienceFiction: 'no', followsDevelopment: 'no' } });
  assert.equal(changed.verdict, 'no');
});

test('Bez intencji i ankiety nie pojawia się porada zakupu; schema jest kompletna', () => {
  assert.equal(updatePurchaseSurvey({ intent: false, answers: { scienceFiction: 'yes' } }), null);
  const schema = purchaseSchema().purchaseAnswers;
  assert.deepEqual(schema.required.sort(), Object.keys(schema.properties).sort());
});


test('Opisowa odpowiedź kontynuuje oczekującą ankietę, nowy temat i powitanie ją opuszczają', () => {
  for (const [content, topics] of [
    ['Uwielbiam SF i jestem świadom ryzyka.', ['project']],
    ['Co lubisz w Argo?', ['ships']],
    ['Cześć!', []],
  ]) {
    const result = selectPersonalityContext({ content, previousTopics: ['project'], purchasePending: true,
      contextModules: personality.contextModules });
    assert.deepEqual(result.topics, topics);
  }
});
