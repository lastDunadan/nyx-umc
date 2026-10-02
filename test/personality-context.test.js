const assert = require('node:assert/strict');
const { test } = require('node:test');
const { selectPersonalityContext } = require('../modules/personality-context');

const contextModules = ['umc', 'ships', 'humor'].map((id) => ({
  id, title: id, content: `${id} module`,
}));

const cases = [
  ['Nyx, co lubisz w statkach Argo?', [], ['ships']],
  ['Nyx AI, tylko tyle?', ['ships'], ['ships']],
  ['A jego uzbrojenie?', ['ships'], ['ships']],
  ['Wyjaśnij to.', ['ships'], ['ships']],
  ['Opowiedz o UMC.', ['ships'], ['umc']],
  ['Opowiedz więcej.', ['umc'], ['umc']],
  ['Co sądzisz o naszej załodze?', [], ['umc']],
  ['Co myślisz o Axinpelu?', [], ['umc']],
  ['Opowiedz o Alice Void.', [], ['umc']],
  ['Latałeś Cutterem albo Aurorą?', [], ['ships']],
  ['Co myślisz o Aurorze i Railenie?', [], ['ships']],
  ['Opowiedz żart o statkach.', [], ['humor', 'ships']],
  ['That’s what she said!', [], ['humor']],
  ['Jaką muzykę lubisz?', ['ships'], []],
  ['Wyjaśnij historię muzyki.', ['ships'], []],
  ['A co jeszcze lubisz w muzyce?', ['ships'], []],
  ['Cześć, Nyx!', ['ships'], []],
];

for (const [content, previousTopics, expected] of cases) {
  test(content, () => {
    const result = selectPersonalityContext({ content, contextModules, previousTopics });
    assert.deepEqual(result.topics, expected);
    assert.equal(result.contextKey, expected.join('|') || 'core');
    for (const { id, content: moduleContent } of contextModules) {
      assert.equal(result.instructions.includes(moduleContent), expected.includes(id));
    }
  });
}

test('Nie dołącza modułu, którego nie ma w rejestrze', () => {
  const result = selectPersonalityContext({ content: 'Opowiedz o UMC.', contextModules: [] });
  assert.equal(result.contextKey, 'core');
  assert.equal(result.instructions, '');
});
