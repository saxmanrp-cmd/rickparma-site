import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = fs.readFileSync(new URL('../song-request/index-base.html', import.meta.url),'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

test('two modes show a choice, while a single enabled mode opens directly', () => {
  const elements = new Map();
  const document = { getElementById(id){
    if(!elements.has(id)) elements.set(id,{ style:{display:id==='loadingState'?'none':'none'} });
    return elements.get(id);
  } };
  const context = vm.createContext({ document, window:{ scrollTo(){} } });
  vm.runInContext(`let performanceModeEnabled=true,djModeEnabled=false,requestView='choose';
    ${script.slice(script.indexOf('function renderRequestMode()'),script.indexOf('let artistSearchTimer ='))}`,context);
  context.renderRequestMode();
  assert.equal(elements.get('homeScreen').style.display,'block');
  vm.runInContext('djModeEnabled=true; requestView="choose";',context);
  context.renderRequestMode();
  assert.equal(elements.get('modeChooser').style.display,'block');
  context.chooseRequestMode('dj');
  assert.equal(elements.get('djRequestScreen').style.display,'block');
  vm.runInContext('performanceModeEnabled=false;',context);
  context.renderRequestMode();
  assert.equal(elements.get('modeChooser').style.display,'none');
  assert.equal(elements.get('djRequestScreen').style.display,'block');
  vm.runInContext('djModeEnabled=false;',context);
  context.renderRequestMode();
  assert.equal(elements.get('modeUnavailable').style.display,'block');
});

test('DJ form requires artist and song and carries optional link through checkout', () => {
  const values = { djArtist:'Earth, Wind & Fire',djSong:'September',djGuestName:'',djLink:'https://youtu.be/example' };
  const context = vm.createContext({ URL, URLSearchParams,
    document:{ getElementById(id){ return { value:values[id] || '' }; } },
    window:{ location:{href:''} },
    alert(message){ throw new Error(message); },
    prices:{general:5}, djModeEnabled:true
  });
  vm.runInContext(script.slice(script.indexOf('function submitDjRequest(event)'),script.indexOf('async function refreshSongs()')),context);
  context.submitDjRequest({preventDefault(){}});
  const url = new URL(context.window.location.href,'https://rickparma.com');
  assert.equal(url.searchParams.get('dj'),'1');
  assert.equal(url.searchParams.get('djSong'),'September');
  assert.equal(url.searchParams.get('djArtist'),'Earth, Wind & Fire');
  assert.equal(url.searchParams.get('requestLink'),'https://youtu.be/example');
  values.djArtist='';
  assert.throws(() => context.submitDjRequest({preventDefault(){}}),/artist and song/);
});
