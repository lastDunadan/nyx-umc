const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  MUSIC_TRACKS, selectMusicTracks, isMusicTopic, buildMusicInstructions, formatMusicLink,
} = require('../modules/music');

test('Katalog zawiera wszystkie 19 utworów, unikalne ID i linki YouTube', () => {
  const ids = [
    'lost-boy', 'the-pretender', 'the-fight-song', 'rock-is-dead',
    'the-boys-are-back', 'uprising', 'this-is-war', 'heavy-is-the-crown',
    'red-right-hand', 'come-join-the-murder', 'killing-in-the-name',
    'civil-war', 'get-in-the-ring', 'knockin-on-heavens-door', 'sixteen-tons',
    'rich-men-north-of-richmond', 'hide-the-pain', 'whiskey-in-the-jar', 'big-enough',
  ];
  assert.deepEqual(MUSIC_TRACKS.map(({ id }) => id), ids);
  assert.equal(new Set(ids).size, MUSIC_TRACKS.length);
  for (const track of MUSIC_TRACKS) {
    assert.ok(track.title && track.artist && track.whyNyxLikes && track.tags.length);
    assert.match(track.youtubeUrl, /^https:\/\/youtu\.be\/[A-Za-z0-9_-]{11}$/);
  }
});

test('Ulubiona piosenka pozostaje hymnem Nyx, nawet gdy była ostatnio polecana', () => {
  const tracks = selectMusicTracks({
    content: 'Nyx, jaka jest Twoja ulubiona piosenka?', recentTrackIds: ['lost-boy'],
  });
  assert.equal(tracks[0].id, 'lost-boy');
  assert.equal(tracks.length, 5);
});

test('Wskazanie tytułu/wykonawcy ogranicza kandydatów do pasujących utworów', () => {
  assert.deepEqual(selectMusicTracks({ content: 'THE PRETENDER!' }).map(({ id }) => id), ['the-pretender']);
  assert.deepEqual(selectMusicTracks({ content: '16 Tons' }).map(({ id }) => id), ['sixteen-tons']);
  const tracks = selectMusicTracks({ content: "Poleć coś Guns N’ Roses" });
  assert.equal(tracks.length, 3);
  assert.ok(tracks.every(({ artist }) => artist === "Guns N' Roses"));
  assert.deepEqual(selectMusicTracks({ content: 'Poproszę Big Enough', recentTrackIds: ['big-enough'] })
    .map(({ id }) => id), ['big-enough']);
});

test('Nastrój wpływa na wybór, a pięć ostatnich propozycji ustępuje nowym', () => {
  const blues = selectMusicTracks({ content: 'Poleć coś bluesowego' });
  assert.ok(blues.slice(0, 2).every(({ tags }) => tags.includes('blues')));
  const recentTrackIds = MUSIC_TRACKS.slice(0, 5).map(({ id }) => id);
  const tracks = selectMusicTracks({ content: 'Poleć piosenkę', recentTrackIds });
  assert.ok(tracks.every(({ id }) => !recentTrackIds.includes(id)));
});

test('Router rozpoznaje muzykę i nazwy, ale nie zwykłe pytanie o statek', () => {
  for (const text of ['Jaką muzykę lubisz?', 'Co jeszcze lubisz w muzyce?', 'The Lost Boy', 'dark country']) {
    assert.equal(isMusicTopic(text), true, text);
  }
  assert.equal(isMusicTopic('Co sądzisz o Metallica?'), true);
  assert.equal(isMusicTopic('Co sądzisz o Metallice?'), true);
  assert.equal(isMusicTopic('Doradź statek na start!'), false);
});

test('Model dostaje opisy i ID, a link jest składany z lokalnego katalogu', () => {
  const track = MUSIC_TRACKS[0];
  const instructions = buildMusicInstructions([track]);
  assert.ok(instructions.includes(track.whyNyxLikes));
  assert.ok(instructions.includes(track.id));
  assert.ok(!instructions.includes(track.youtubeUrl));
  assert.ok(!buildMusicInstructions([]).includes(track.title));
  assert.ok(formatMusicLink(track).endsWith(track.youtubeUrl));
});

test('Gust jest modułem opcjonalnym i nie powiększa stałego promptu', () => {
  const { basePrompt, contextModules } = require('../modules/personality');
  const music = contextModules.find(({ id }) => id === 'music');
  assert.ok(music.content.includes('The Lost Boy'));
  assert.ok(!basePrompt.includes(music.content));
});
