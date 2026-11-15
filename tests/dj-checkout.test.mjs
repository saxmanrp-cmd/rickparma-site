import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createPublicIntent, fulfillSongRequest } from '../functions/api/[[path]].js';

test('DJ checkout is gated by mode and retains artist, song, and pasted link', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE payment_intents (
    id TEXT PRIMARY KEY,type TEXT,status TEXT,amount_cents INTEGER,currency TEXT,
    title TEXT,description TEXT,reference TEXT,customer_name TEXT,customer_email TEXT,
    customer_phone TEXT,metadata_json TEXT,created_at TEXT,updated_at TEXT,
    origin_app TEXT,fulfillment_status TEXT,provider_payment_id TEXT
  ); CREATE TABLE payment_events (
    id TEXT PRIMARY KEY,intent_id TEXT,event_type TEXT,provider TEXT,provider_id TEXT,
    amount_cents INTEGER,payload_json TEXT,created_at TEXT
  );`);
  const env = { PAYMENT_DB:{ prepare(query){ return { bind(...values){
    const statement=sql.prepare(query);
    return { async run(){ return statement.run(...values); }, async first(){ return statement.get(...values); } };
  } }; } } };
  let settings = { songRequestLive:true, performanceModeEnabled:true, djModeEnabled:false };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({record:settings});
  const body = { type:'song_request', amountCents:500, customerName:'', song:'DJ: September — Earth, Wind & Fire',
    djRequest:true, djSong:'September', djArtist:'Earth, Wind & Fire', requestLink:'https://youtu.be/example' };
  const create = () => createPublicIntent(new Request('https://rickparma.com/api/intents/public',
    {method:'POST',body:JSON.stringify(body)}),env);
  try {
    assert.equal((await create()).status,409);
    settings = {...settings,djModeEnabled:true};
    const result=await create();
    assert.equal(result.status,201);
    const intent=(await result.json()).intent;
    assert.equal(intent.metadata.requestType,'dj');
    assert.equal(intent.metadata.djArtist,'Earth, Wind & Fire');
    assert.equal(intent.metadata.djSong,'September');
    assert.equal(intent.metadata.requestLink,'https://youtu.be/example');
    settings = {...settings,songRequestLive:false};
    assert.equal((await create()).status,409);
    settings = {songRequestLive:true,performanceModeEnabled:false,djModeEnabled:true};
    body.djRequest=false;
    assert.equal((await create()).status,409);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM payment_intents').get().n,1);
  } finally { globalThis.fetch=originalFetch; sql.close(); }
});

test('paid DJ request reaches the request list and text with the shared link', async () => {
  const originalFetch=globalThis.fetch;
  let logged, alert;
  globalThis.fetch=async (url,options={}) => {
    if(url.endsWith('/songs')) return Response.json({record:{smsRequestsEnabled:true}});
    if(url.endsWith('/song-requests-log')) {
      if(options.method === 'PUT'){ logged=JSON.parse(options.body).requests[0]; return Response.json({ok:true}); }
      return Response.json({record:{requests:[]}});
    }
    if(url.includes('/song-alert')) { alert=new URLSearchParams(options.body); return Response.json({ok:true}); }
    throw new Error('Unexpected request');
  };
  try {
    const result=await fulfillSongRequest({}, {id:'dj-1',customerName:'Someone',
      metadata:{song:'DJ: September',requestType:'dj',djSong:'September',djArtist:'Earth, Wind & Fire',requestLink:'https://youtu.be/example'}});
    assert.equal(result,'FULFILLED');
    assert.equal(logged.requestType,'dj');
    assert.equal(logged.artist,'Earth, Wind & Fire');
    assert.equal(logged.requestLink,'https://youtu.be/example');
    assert.match(alert.get('song'),/DJ request: September.*Link: https:\/\/youtu.be\/example/);
  } finally { globalThis.fetch=originalFetch; }
});
