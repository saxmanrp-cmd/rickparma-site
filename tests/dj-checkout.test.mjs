import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createPublicIntent, fulfillSongRequest, fulfillTip } from '../functions/api/[[path]].js';

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
    assert.equal((await create()).status,400);
    body.amountCents=1200;
    const result=await create();
    assert.equal(result.status,201);
    const intent=(await result.json()).intent;
    assert.equal(intent.amountCents,1200);
    assert.equal(intent.metadata.requestType,'dj');
    assert.equal(intent.metadata.djArtist,'Earth, Wind & Fire');
    assert.equal(intent.metadata.djSong,'September');
    assert.equal(intent.metadata.requestLink,'https://youtu.be/example');
    body.amountCents=2000;
    const extra=await create();
    assert.equal(extra.status,201);
    assert.equal((await extra.json()).intent.amountCents,2000);
    body.djRequest=false;
    body.amountCents=600;
    assert.equal((await create()).status,400);
    body.amountCents=700;
    const performance=await create();
    assert.equal(performance.status,201);
    assert.equal((await performance.json()).intent.amountCents,700);
    const bogoLabel=`${'A'.repeat(75)} + BOGO: ${'B'.repeat(75)}`;
    body.song=bogoLabel;
    const bogo=await create();
    assert.equal(bogo.status,201);
    assert.equal((await bogo.json()).intent.metadata.song,bogoLabel);
    body.djRequest=true;
    body.amountCents=500;
    settings = {...settings,songRequestLive:false};
    assert.equal((await create()).status,409);
    settings = {songRequestLive:true,performanceModeEnabled:false,djModeEnabled:true,prices:{general:7,dj:12}};
    body.djRequest=false;
    assert.equal((await create()).status,409);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM payment_intents').get().n,4);
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

test('paid and BOGO requests use short texts with the songs and optional name', async () => {
  const originalFetch=globalThis.fetch;
  const messages=[];
  globalThis.fetch=async (url,options={}) => {
    if(url.endsWith('/songs')) return Response.json({record:{smsRequestsEnabled:true}});
    if(url.endsWith('/song-requests-log')) return Response.json({record:{requests:[]}});
    if(url.endsWith('/api/conversations/reply')) { messages.push(JSON.parse(options.body).message); return Response.json({ok:true}); }
    throw new Error('Unexpected request');
  };
  try {
    const env={SMS_BLAST_ADMIN_TOKEN:'test-token',TIP_NOTIFICATION_PHONE:'7732091124'};
    assert.equal(await fulfillSongRequest(env, {id:'performance-1',customerName:'Guest',metadata:{song:'September - EWF'}}),'FULFILLED');
    assert.equal(await fulfillSongRequest(env, {id:'bogo-1',metadata:{song:'September - EWF + BOGO: Superstition - Stevie Wonder'}}),'FULFILLED');
    assert.deepEqual(messages,['PAID\nSeptember - EWF\nName: Guest','BOGO\nSeptember - EWF\nSuperstition - Stevie Wonder']);
  } finally { globalThis.fetch=originalFetch; }
});

test('tip text has only its heading, optional name, and amount', async () => {
  const originalFetch=globalThis.fetch;
  const messages=[];
  globalThis.fetch=async (_url,options={}) => { messages.push(JSON.parse(options.body).message); return Response.json({ok:true}); };
  try {
    const env={SMS_BLAST_ADMIN_TOKEN:'test-token',TIP_NOTIFICATION_PHONE:'7732091124'};
    assert.equal(await fulfillTip(env,{id:'tip-1',customerName:'Alex',amountCents:1200}),'FULFILLED');
    assert.equal(await fulfillTip(env,{id:'tip-2',amountCents:550}),'FULFILLED');
    assert.deepEqual(messages,['TIP\nAlex\n$12','TIP\n$5.50']);
  } finally { globalThis.fetch=originalFetch; }
});

test('a failed request-log write does not mark a paid DJ request fulfilled', async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (url,options={}) => {
    if(url.endsWith('/song-requests-log')) return options.method === 'PUT'
      ? new Response('unavailable',{status:503}) : Response.json({record:{requests:[]}});
    throw new Error('An alert must wait until the request is logged');
  };
  try {
    const result=await fulfillSongRequest({SMS_BLAST_ADMIN_TOKEN:'test',TIP_NOTIFICATION_PHONE:'7732091124'},
      {id:'dj-retry',metadata:{requestType:'dj',djArtist:'Bruno Mars',djSong:'Treasure'}});
    assert.equal(result,'ERROR');
  } finally { globalThis.fetch=originalFetch; }
});

test('retrying a paid DJ request leaves one request-list entry', async () => {
  const originalFetch=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async (url,options={}) => {
    if(url.endsWith('/song-requests-log')) {
      if(options.method === 'PUT') { requests.splice(0,requests.length,...JSON.parse(options.body).requests); return Response.json({ok:true}); }
      return Response.json({record:{requests}});
    }
    if(url.endsWith('/songs')) return Response.json({record:{smsRequestsEnabled:false}});
    throw new Error('Unexpected request');
  };
  try {
    const intent={id:'dj-retry',metadata:{requestType:'dj',djArtist:'Bruno Mars',djSong:'Treasure'}};
    assert.equal(await fulfillSongRequest({},intent),'FULFILLED');
    assert.equal(await fulfillSongRequest({},intent),'FULFILLED');
    assert.equal(requests.length,1);
    assert.equal(requests[0].song,'Treasure');
  } finally { globalThis.fetch=originalFetch; }
});

