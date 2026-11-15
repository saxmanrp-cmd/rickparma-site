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
  let settings = { songRequestLive:true, performanceModeEnabled:true, djModeEnabled:false, prices:{general:7,dj:12} };
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
    assert.equal(intent.amountCents,1200);
    assert.equal(intent.metadata.requestType,'dj');
    assert.equal(intent.metadata.djArtist,'Earth, Wind & Fire');
    assert.equal(intent.metadata.djSong,'September');
    assert.equal(intent.metadata.requestLink,'https://youtu.be/example');
    body.djRequest=false;
    body.amountCents=700;
    const performance=await create();
    assert.equal(performance.status,201);
    assert.equal((await performance.json()).intent.amountCents,700);
    body.djRequest=true;
    body.amountCents=500;
    settings = {...settings,songRequestLive:false};
    assert.equal((await create()).status,409);
    settings = {songRequestLive:true,performanceModeEnabled:false,djModeEnabled:true,prices:{general:7,dj:12}};
    body.djRequest=false;
    assert.equal((await create()).status,409);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM payment_intents').get().n,2);
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
    if(url.endsWith('/api/conversations/reply')) { alert=JSON.parse(options.body); return Response.json({ok:true}); }
    throw new Error('Unexpected request');
  };
  try {
    const result=await fulfillSongRequest({SMS_BLAST_ADMIN_TOKEN:'test-token',TIP_NOTIFICATION_PHONE:'7732091124'}, {id:'dj-1',customerName:'Someone',
      metadata:{song:'DJ: September',requestType:'dj',djSong:'September',djArtist:'Earth, Wind & Fire',requestLink:'https://youtu.be/example'}});
    assert.equal(result,'FULFILLED');
    assert.equal(logged.requestType,'dj');
    assert.equal(logged.artist,'Earth, Wind & Fire');
    assert.equal(logged.requestLink,'https://youtu.be/example');
    assert.equal(alert.phone,'+17732091124');
    assert.equal(alert.message,'DJ request\nArtist: Earth, Wind & Fire\nSong: September\nhttps://youtu.be/example');
  } finally { globalThis.fetch=originalFetch; }
});

test('DJ text omits the link line when no URL was provided', async () => {
  const originalFetch=globalThis.fetch;
  let message;
  globalThis.fetch=async (url,options={}) => {
    if(url.endsWith('/songs')) return Response.json({record:{smsRequestsEnabled:true}});
    if(url.endsWith('/song-requests-log')) return Response.json({record:{requests:[]}});
    if(url.endsWith('/api/conversations/reply')) { message=JSON.parse(options.body).message; return Response.json({ok:true}); }
    throw new Error('Unexpected request');
  };
  try {
    const result=await fulfillSongRequest({SMS_BLAST_ADMIN_TOKEN:'test-token',TIP_NOTIFICATION_PHONE:'7732091124'}, {id:'dj-2',
      metadata:{requestType:'dj',djSong:'September',djArtist:'Earth, Wind & Fire'}});
    assert.equal(result,'FULFILLED');
    assert.equal(message,'DJ request\nArtist: Earth, Wind & Fire\nSong: September');
  } finally { globalThis.fetch=originalFetch; }
});

test('performance requests keep the existing song alert format', async () => {
  const originalFetch=globalThis.fetch;
  let alert;
  globalThis.fetch=async (url,options={}) => {
    if(url.endsWith('/songs')) return Response.json({record:{smsRequestsEnabled:true}});
    if(url.endsWith('/song-requests-log')) return Response.json({record:{requests:[]}});
    if(url.includes('/song-alert')) { alert=new URLSearchParams(options.body); return Response.json({ok:true}); }
    throw new Error('Unexpected request');
  };
  try {
    assert.equal(await fulfillSongRequest({}, {id:'performance-1',customerName:'Guest',metadata:{song:'September'}}),'FULFILLED');
    assert.equal(alert.get('song'),'September');
    assert.equal(alert.get('outcome'),'PAID');
  } finally { globalThis.fetch=originalFetch; }
});
