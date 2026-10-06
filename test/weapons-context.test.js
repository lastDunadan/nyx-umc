const assert = require('node:assert/strict');
const { test } = require('node:test');
const { selectPersonalityContext } = require('../modules/personality-context');
const personality = require('../modules/personality');

const cases = [
  ['Nyx, jaka jest Twoja ulubiona broń?', [], ['weapons']],
  ['Co lubisz w broni Gemini?', [], ['weapons']],
  ['Poleć shotgun do bunkrów!', [], ['weapons']],
  ['R97 czy BR-2?', [], ['weapons']],
  ['Co powiesz o BR 2?', [], ['weapons']],
  ['Lubisz Kastak Arms i Ravager-212?', [], ['weapons']],
  ['Co myślisz o Hedeby Gunworks?', [], ['weapons']],
  ['Pulverizer, Killshot czy Ripper?', [], ['weapons']],
  ['Dlaczego lubisz Clema?', [], ['weapons']],
  ['Blondyna używa Arlingtona.', [], ['umc', 'weapons']],
  ['Tylko tyle?', ['weapons'], ['weapons']],
  ['A jego uzbrojenie?', ['ships'], ['ships']],
  ['Dobierz loadout do bunkrów.', [], ['weapons']],
  ['Poleć loadout.', ['weapons'], ['weapons']],
  ['Poleć loadout.', ['ships'], ['ships']],
  ['Dobierz build do Titana.', ['weapons'], ['ships']],
  ['Jaką broń dobrać do Arrowa?', ['weapons'], ['ships']],
  ['Co lubisz w Starfarerze Gemini?', [], ['ships']],
  ['R97 na pokładzie Carracka?', [], ['ships', 'weapons']],
  ['Jaką muzykę lubisz?', ['weapons'], ['music']],
  ['Cześć, Nyx!', ['weapons'], []],
];

for (const [content, previousTopics, topics] of cases) {
  test(`Broń i inne tematy: ${content}`, () => {
    const context = selectPersonalityContext({
      content, previousTopics, contextModules: personality.contextModules,
    });
    assert.deepEqual(context.topics, topics);
    assert.equal(context.instructions.includes(personality.weaponPrefs), topics.includes('weapons'));
  });
}

test('Ulubione modele i historia Clema są poza stałym promptem', () => {
  assert.ok(personality.weaponPrefs.includes('R97'));
  assert.ok(personality.weaponPrefs.includes('Arlington'));
  assert.ok(!personality.basePrompt.includes(personality.weaponPrefs));
  assert.ok(!personality.basePrompt.includes('R97'));
  const context = selectPersonalityContext({ content: 'Cześć!', contextModules: personality.contextModules });
  assert.equal(context.instructions, '');
  assert.ok(personality.basePrompt.includes('## Gust a praktyczne doradzanie'));
});

test('Niedostępny moduł broni nie jest dołączany', () => {
  const context = selectPersonalityContext({ content: 'R97', contextModules: [] });
  assert.equal(context.contextKey, 'core');
  assert.equal(context.instructions, '');
});
