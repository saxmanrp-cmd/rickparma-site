import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { onRequest as spin } from '../functions/api/song-spin.js';
import { sendFreeSongAlert } from '../functions/api/[[path]].js';

test('one verified free spin sends one short FREE text', async () => {
  const sql = new DatabaseSync(':memory:');
  const env = {
    PAYMENT_DB:{prepare(query){ const statement=sql.prepare(query); return {
      async run(){ return statement.run(); },
      bind(...values){ return {
        async run(){ return statement.run(...values); },
        async first(){ return statement.get(...values); }
      }; }
    }; }},
    SMS_BLAST_ADMIN_TOKEN:'test-token', TIP_NOTIFICATION_PHONE:'7732091124'
  };
  const originalFetch=globalThis.fetch;
  const messages=[];
  globalThis.fetch=async (url,options={}) => {
    if(url.endsWith('/songs')) return Response.json({record:{songRequestLive:true,performanceModeEnabled:true,
      songs:[{id:'s1',t:'September',a:'EWF'}]}});
    if(url.endsWith('/api/conversations/reply')) { messages.push(JSON.parse(options.body).message); return Response.json({ok:true}); }
    throw new Error('Unexpected request');
  };
  try {
    let result;
    for(let i=0;i<7;i++) result=await (await spin({request:new Request('https://rickparma.com/api/song-spin',
      {method:'POST',body:JSON.stringify({songId:'s1'})}),env})).json();
    assert.equal(result.outcome,'FREE');
    assert.ok(result.token);
    const submit=async (name) => sendFreeSongAlert(new Request('https://rickparma.com/api/song-free-alert',
      {method:'POST',body:JSON.stringify({token:result.token,songId:'s1',name})}),env);
    assert.equal((await submit('Alex')).status,200);
    assert.deepEqual(messages,['FREE\nSeptember - EWF\nName: Alex']);
    assert.equal((await submit('Alex')).status,409);
    assert.equal(messages.length,1);
  } finally { globalThis.fetch=originalFetch; sql.close(); }
});

test('a name entered with BOGO songs reaches the payment form', () => {
  let click;
  const songs=[{id:'s1',t:'September',a:'EWF'},{id:'s2',t:'Superstition',a:'Stevie Wonder'}];
  const context=vm.createContext({
    URL, location:{href:'https://rickparma.com/song-request/'}, songs,
    window:{songs},
    document:{
      addEventListener(type,handler){ if(type==='click') click=handler; },
      getElementById(id){ return id==='reqName' ? {value:'Alex'} : null; }
    }
  });
  vm.runInContext(fs.readFileSync(new URL('../song-request/request-safety.js',import.meta.url),'utf8'),context);
  const link={href:'https://rickparma.com/pay/?mode=song&song=September%20-%20EWF%20%2B%20BOGO%3A%20Superstition%20-%20Stevie%20Wonder'};
  click({target:{closest(){ return link; }}});
  const url=new URL(link.href);
  assert.equal(url.searchParams.get('name'),'Alex');
  assert.equal(url.searchParams.get('songRequestId'),'s1,s2');
});
