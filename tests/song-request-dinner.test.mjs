import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = fs.readFileSync(new URL('../song-request/index-base.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

test('guest catalog shows only marked dinner songs while mode is active', () => {
  const context = vm.createContext({});
  const code = script.slice(script.indexOf('let powerSongsAvailable ='), script.indexOf('async function refreshSongs()'));
  vm.runInContext(`let songs=[]; let prices={}; let DEFAULT_PRICES={};
    function renderBubbles(){} function renderChips(){} function renderList(){}; ${code}`, context);
  const source = [
    { id:'dinner', t:'Quiet Song', tags:['Jazz'], dinnerMusic:true },
    { id:'dance', t:'Dance Song', tags:['Dance'] },
    { id:'power', t:'Power Dinner', tags:[], dinnerMusic:true, powerSong:true }
  ];
  context.applySongRecord({ songs:source, dinnerMusicOnly:true });
  assert.equal(vm.runInContext('songs.map(s=>s.id).join(",")',context), 'dinner');
  context.applySongRecord({ songs:source, dinnerMusicOnly:false });
  assert.equal(vm.runInContext('songs.map(s=>s.id).join(",")',context), 'dinner,dance');
  context.applySongRecord({ songs:source, dinnerMusicOnly:true, powerSongsAvailable:true });
  assert.equal(vm.runInContext('songs.map(s=>s.id).join(",")',context), 'dinner,power');
});
