import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../photo-manager.html', import.meta.url), 'utf8');
const script = html.split('<script>',2)[1].split('</script>',1)[0];
const publisher = script.slice(
  script.indexOf('  var flyerPublishQueue = Promise.resolve();'),
  script.indexOf('  async function pushToWebsite()')
);

function makeHarness(statuses, {connected=true}={}) {
  let putCount = 0;
  const calls = [];
  const photos = [{
    src:'https://rickparma.com/media/toga.mp4',
    name:'Toga',
    dates:['2026-11-24','2026-11-26'],
    eventIds:['toga-nov24','toga-nov26']
  }];
  const context = vm.createContext({
    Date,Math,Promise,setTimeout,encodeURIComponent,unescape,
    btoa:value=>Buffer.from(value,'binary').toString('base64'),
    GH_TOKEN:connected?'mock-token':'',
    GH_OWNER:'saxmanrp-cmd',GH_REPO:'rickparma-site',GH_BRANCH:'main',
    photos,ghHeaders:()=>({Authorization:'token mock-token'}),
    fetch:async (url,options={})=>{
      const method = options.method || 'GET';
      calls.push({url,method,cache:options.cache,body:options.body && JSON.parse(options.body)});
      if (method === 'GET') {
        return {ok:true,status:200,json:async()=>({sha:putCount===0?'old-sha':'fresh-sha'})};
      }
      const status = statuses[Math.min(putCount++,statuses.length-1)];
      return {
        ok:status === 200,
        status,
        json:async()=>({message:status===409?'SHA does not match current file':'Permission denied'})
      };
    }
  });
  vm.runInContext(publisher,context);
  return {context,calls,photos};
}

test('Photo Manager JS compiles with the queued publisher',()=>{
  assert.doesNotThrow(()=>new vm.Script(script));
  assert.ok(publisher.includes('cache:"no-store"'));
});

test('retries a stale SHA 409 and publishes both TOGA dates without a second calendar event',async()=>{
  const {context,calls}=makeHarness([409,200]);
  await context.pushFlyersJson();
  assert.deepEqual(calls.map(x=>x.method),['GET','PUT','GET','PUT']);
  assert.notEqual(calls[0].url,calls[2].url);
  assert.equal(calls[0].cache,'no-store');
  assert.equal(calls[2].cache,'no-store');
  assert.equal(calls[1].body.sha,'old-sha');
  assert.equal(calls[3].body.sha,'fresh-sha');
  const sent=JSON.parse(Buffer.from(calls[3].body.content,'base64').toString('utf8'));
  assert.deepEqual(sent[0].dates,['2026-11-24','2026-11-26']);
  assert.deepEqual(sent[0].eventIds,['toga-nov24','toga-nov26']);
  assert.equal(calls.some(x=>x.url.includes('googleapis.com')),false);
});

test('first TOGA date publishes, second gets 409 then saves both links after retry',async()=>{
  let getNumber=0;
  let putNumber=0;
  const {context,calls,photos}=makeHarness([200,409,200]);
  // The server can return the prior file SHA immediately after a successful write.
  context.fetch = async (url,options={})=>{
    const method=options.method || 'GET';
    calls.push({method,url,body:options.body && JSON.parse(options.body)});
    if(method==='GET'){
      getNumber++;
      return {ok:true,status:200,json:async()=>({sha:getNumber<3?'first-sha':'second-sha'})};
    }
    putNumber++;
    const status=[200,409,200][putNumber-1];
    return {ok:status===200,status,json:async()=>({message:'SHA conflict'})};
  };
  photos[0].dates=['2026-11-24'];
  photos[0].eventIds=['toga-nov24'];
  await context.pushFlyersJson();
  photos[0].dates.push('2026-11-26');
  photos[0].eventIds.push('toga-nov26');
  await context.pushFlyersJson();
  assert.deepEqual(calls.map(c=>c.method),['GET','PUT','GET','PUT','GET','PUT']);
  assert.equal(calls[3].body.sha,'first-sha');
  assert.equal(calls[5].body.sha,'second-sha');
  const published=JSON.parse(Buffer.from(calls[5].body.content,'base64').toString('utf8'));
  assert.deepEqual(published[0].dates,['2026-11-24','2026-11-26']);
  assert.deepEqual(published[0].eventIds,['toga-nov24','toga-nov26']);
});

test('two quick Save + Another Date publishes serialize instead of racing',async()=>{
  const {context,calls}=makeHarness([200,200]);
  await Promise.all([context.pushFlyersJson(),context.pushFlyersJson()]);
  assert.deepEqual(calls.map(x=>x.method),['GET','PUT','GET','PUT']);
});

test('persistent conflicts stop after bounded retries and report failure',async()=>{
  const {context,calls}=makeHarness([409]);
  await assert.rejects(context.pushFlyersJson(),/Publish failed \(409\)/);
  assert.equal(calls.filter(x=>x.method==='PUT').length,4);
});

test('non-conflict authorization errors are not retried',async()=>{
  const {context,calls}=makeHarness([403]);
  await assert.rejects(context.pushFlyersJson(),/Publish failed \(403\)/);
  assert.deepEqual(calls.map(x=>x.method),['GET','PUT']);
});

test('missing GitHub authorization does not attempt any changes',async()=>{
  const {context,calls}=makeHarness([200],{connected:false});
  await assert.rejects(context.pushFlyersJson(),/Connect your GitHub token/);
  assert.equal(calls.length,0);
});
