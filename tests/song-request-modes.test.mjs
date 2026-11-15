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
    prices:{general:5,dj:12}, djModeEnabled:true
  });
  vm.runInContext(script.slice(script.indexOf('function submitDjRequest(event)'),script.indexOf('async function refreshSongs()')),context);
  context.submitDjRequest({preventDefault(){}});
  const url = new URL(context.window.location.href,'https://rickparma.com');
  assert.equal(url.searchParams.get('dj'),'1');
  assert.equal(url.searchParams.get('djSong'),'September');
  assert.equal(url.searchParams.get('djArtist'),'Earth, Wind & Fire');
  assert.equal(url.searchParams.get('requestLink'),'https://youtu.be/example');
  assert.equal(url.searchParams.get('amount'),'12');
  values.djArtist='';
  assert.throws(() => context.submitDjRequest({preventDefault(){}}),/artist and song/);
});

test('artist suggestions show familiar matches immediately and add live matches as spelling changes', async () => {
  const children = [];
  const artist = { value:'Bru', attributes:{}, setAttribute(key,value){ this.attributes[key]=value; } };
  const box = { replaceChildren(){ children.length=0; }, appendChild(node){ children.push(node); } };
  let timer;
  const context = vm.createContext({
    familiarArtists:['Bruno Mars','Stevie Wonder'], URLSearchParams, AbortController,
    document:{
      getElementById(id){ return id==='djArtist' ? artist : id==='artistSuggestions' ? box : {focus(){}}; },
      createElement(){ return { setAttribute(){}, appendChild(){}, textContent:'' }; }
    },
    clearTimeout(){}, setTimeout(fn){ timer=fn; },
    async fetch(){ return {ok:true,async json(){ return {search:[{label:'Bruce Springsteen',description:'American rock singer'}]}; }}; }
  });
  vm.runInContext(script.slice(script.indexOf('let artistSearchTimer ='),script.indexOf('function submitDjRequest(event)')),context);
  context.suggestArtists();
  assert.deepEqual(children.map(node => node.textContent),['Bruno Mars']);
  await timer();
  assert.deepEqual(children.map(node => node.textContent),['Bruno Mars','Bruce Springsteen']);
  artist.value='Bruno';
  context.suggestArtists();
  assert.deepEqual(children.map(node => node.textContent),['Bruno Mars']);
  assert.equal(artist.attributes['aria-expanded'],'true');
});
