import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source=fs.readFileSync(new URL('../functions/api/photo-calendar/[[path]].js',import.meta.url),'utf8')
  .replace(/export const /g,'const ');
const ORIGIN='https://rickparma.com';
const route='/api/photo-calendar/';
const secrets={
  PHOTO_CALENDAR_GOOGLE_CLIENT_ID:'123-test.apps.googleusercontent.com',
  PHOTO_CALENDAR_GOOGLE_CLIENT_SECRET:'fake-private-client-secret',
  PHOTO_CALENDAR_OWNER_EMAIL:'owner@example.com',
  PHOTO_CALENDAR_TOKEN_KEY:Buffer.alloc(32,8).toString('base64')
};

class MockD1 {
  constructor() {this.states=new Map();this.sessions=new Map();this.credentials=null;}
  prepare(query) {
    const db=this;
    const stmt={
      args:[],
      bind(...values){this.args=values;return this;},
      async run(){const q=query,a=this.args;
        if(q.startsWith('CREATE TABLE'))return {};
        if(q.startsWith('DELETE FROM rp_calendar_oauth_states WHERE expires_at')){
          for(const [k,v] of db.states)if(v.expires_at<a[0])db.states.delete(k);
          return {};
        }
        if(q.startsWith('INSERT INTO rp_calendar_oauth_states')){
          db.states.set(a[0],{verifier:a[1],expires_at:a[2]});return {};
        }
        if(q.startsWith('INSERT INTO rp_calendar_oauth_credentials')){
          db.credentials={refresh_cipher:a[0],google_subject:a[1],owner_email:a[2]};return {};
        }
        if(q.startsWith('DELETE FROM rp_calendar_oauth_sessions WHERE expires_at')){
          for(const [k,v] of db.sessions)if(v<=a[0])db.sessions.delete(k);
          return {};
        }
        if(q==='DELETE FROM rp_calendar_oauth_sessions'){db.sessions.clear();return {};}
        if(q.startsWith('INSERT INTO rp_calendar_oauth_sessions')){
          db.sessions.set(a[0],a[1]);return {};
        }
        if(q.startsWith('UPDATE rp_calendar_oauth_credentials')){
          db.credentials.refresh_cipher=a[0];return {};
        }
        throw new Error('Unexpected SQL run: '+q);
      },
      async first(){const q=query,a=this.args;
        if(q.startsWith('SELECT 1 FROM rp_calendar_oauth_sessions')){
          return (db.sessions.get(a[0])||0)>a[1] ? {1:1}:null;
        }
        if(q.startsWith('SELECT refresh_cipher FROM rp_calendar_oauth_credentials'))return db.credentials;
        if(q.startsWith('DELETE FROM rp_calendar_oauth_states WHERE state_hash')){
          const entry=db.states.get(a[0])||null;db.states.delete(a[0]);return entry;
        }
        throw new Error('Unexpected SQL first: '+q);
      }
    };
    return stmt;
  }
  async batch(stmts){for(const stmt of stmts)await stmt.run();return [];}
}
function createHarness({configured=true,otherAccount=false,invalidGrant=false}={}) {
  const db=new MockD1(),calls=[];
  const env=configured?{...secrets,PAYMENT_DB:db}:{};
  const fetch=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url).includes('oauth2.googleapis.com/token')){
      const body=new URLSearchParams(options.body);
      if(body.get('grant_type')==='authorization_code'){
        return Response.json({access_token:'access-test',refresh_token:'refresh-test'});
      }
      if(invalidGrant)return Response.json({error:'invalid_grant'},{status:400});
      return Response.json({access_token:'refreshed-test',expires_in:3600});
    }
    if(String(url).includes('openidconnect.googleapis.com/v1/userinfo')){
      return Response.json({sub:'google-owner-id',email:otherAccount?'attacker@example.com':'owner@example.com',email_verified:true});
    }
    if(String(url).includes('googleapis.com/calendar/v3')){
      if(options.method==='DELETE')return new Response(null,{status:204});
      return Response.json({id:'created-show',htmlLink:'https://calendar.google.com/event'});
    }
    throw new Error('Unexpected external request: '+url);
  };
  const context=vm.createContext({
    Date,Math,crypto:webcrypto,URL,URLSearchParams,Request,Response,
    TextEncoder,TextDecoder,atob,btoa,fetch,console
  });
  vm.runInContext(source+'; globalThis.routes={onRequestGet,onRequestPost,onRequestPatch,onRequestDelete};',context);
  const dispatch=async(method,path,{session,origin,query='',body}={})=>{
    const headers={};
    if(origin)headers.origin=origin;
    if(session)headers.cookie=session;
    if(body)headers['content-type']='application/json';
    const request=new Request(ORIGIN+route+path+query,{method,headers,
      ...(body?{body:JSON.stringify(body)}:{})});
    return context.routes['onRequest'+method[0]+method.slice(1).toLowerCase()]({request,env});
  };
  const cookieLine=(res)=>res.headers.get('set-cookie')?.split(';')[0]||'';
  return {db,calls,dispatch,cookieLine};
}
async function authorize(harness) {
  const {dispatch,cookieLine}=harness;
  const start=await dispatch('GET','connect');
  assert.equal(start.status,302);
  const authorization=new URL(start.headers.get('location'));
  assert.equal(authorization.searchParams.get('access_type'),'offline');
  assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
  const state=authorization.searchParams.get('state');
  assert.ok(state);
  const finished=await dispatch('GET','callback',{
    query:'?code=google-code&state='+encodeURIComponent(state),
    session:cookieLine(start)
  });
  return {start,finished,authCookie:cookieLine(finished)};
}
const sample={
  summary:'TOGA Party Band - Orleans',location:'Orleans Hotel Las Vegas',
  description:'Live show',start:{dateTime:'2026-11-24T21:00:00',timeZone:'America/Los_Angeles'},
  end:{dateTime:'2026-11-25T01:00:00',timeZone:'America/Los_Angeles'}
};

test('without Cloudflare secrets, status leaves old sign-in method available',async()=>{
  const h=createHarness({configured:false});
  const status=await h.dispatch('GET','status');
  assert.equal((await status.json()).configured,false);
  assert.equal((await h.dispatch('POST','events',{origin:ORIGIN,body:sample})).status,503);
});

test('connection validates owner, encrypts offline refresh and issues secure session',async()=>{
  const h=createHarness();
  const {finished,authCookie}=await authorize(h);
  assert.equal(finished.status,302);
  assert.equal(finished.headers.get('location'),ORIGIN+'/photo-manager?google_calendar=connected');
  assert.ok(finished.headers.get('set-cookie').includes('HttpOnly; Secure; SameSite=Lax'));
  assert.ok(authCookie.includes('__Host-rp_calendar_session='));
  assert.ok(h.db.credentials.refresh_cipher);
  assert.ok(!h.db.credentials.refresh_cipher.includes('refresh-test'));
  const status=await h.dispatch('GET','status',{session:authCookie});
  assert.equal((await status.json()).connected,true);
});

test('background session creates, patches and deletes without opening Google chooser',async()=>{
  const h=createHarness(),{authCookie}=await authorize(h);
  const post=await h.dispatch('POST','events',{origin:ORIGIN,session:authCookie,body:sample});
  assert.equal(post.status,200);
  assert.equal((await post.json()).id,'created-show');
  const patch=await h.dispatch('PATCH','events/created-show',{origin:ORIGIN,session:authCookie,body:sample});
  assert.equal(patch.status,200);
  const del=await h.dispatch('DELETE','events/created-show',{origin:ORIGIN,session:authCookie});
  assert.equal(del.status,200);
  const writes=h.calls.filter(x=>x.url.includes('googleapis.com/calendar/v3'));
  assert.deepEqual(writes.map(x=>x.options.method),['POST','PATCH','DELETE']);
  const refreshes=h.calls.filter(x=>x.url.includes('oauth2.googleapis.com/token')&&new URLSearchParams(x.options.body).get('grant_type')==='refresh_token');
  assert.equal(refreshes.length,3);
});

test('unauthorized account cannot connect or obtain a session',async()=>{
  const h=createHarness({otherAccount:true});
  const {finished}=await authorize(h);
  assert.equal(finished.status,403);
  assert.equal(h.db.credentials,null);
  assert.equal(h.db.sessions.size,0);
});

test('calendar mutations require both same origin and live session',async()=>{
  const h=createHarness(),{authCookie}=await authorize(h);
  const wrong=await h.dispatch('POST','events',{session:authCookie,origin:'https://evil.example',body:sample});
  assert.equal(wrong.status,403);
  const noSession=await h.dispatch('POST','events',{origin:ORIGIN,body:sample});
  assert.equal(noSession.status,401);
  assert.equal(h.calls.filter(x=>x.url.includes('googleapis.com/calendar/v3')).length,0);
});

test('expired Google refresh token invalidates the session so reconnect can work',async()=>{
  const h=createHarness({invalidGrant:true}),{authCookie}=await authorize(h);
  const attempt=await h.dispatch('POST','events',{origin:ORIGIN,session:authCookie,body:sample});
  assert.equal(attempt.status,401);
  const status=await h.dispatch('GET','status',{session:authCookie});
  assert.equal((await status.json()).connected,false);
});

test('one-time OAuth state cannot be replayed',async()=>{
  const h=createHarness(),{start,finished}=await authorize(h);
  assert.equal(finished.status,302);
  const query=new URL(start.headers.get('location')).searchParams.get('state');
  const replay=await h.dispatch('GET','callback',{query:'?code=google-code&state='+query,session:h.cookieLine(start)});
  assert.equal(replay.status,400);
});
