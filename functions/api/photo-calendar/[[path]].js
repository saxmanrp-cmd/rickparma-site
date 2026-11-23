// Photo Manager background Google Calendar integration.
// Cloudflare Pages Function using the existing PAYMENT_DB D1 binding.
// Set secrets on the Pages project (never put them in GitHub):
// PHOTO_CALENDAR_GOOGLE_CLIENT_ID, PHOTO_CALENDAR_GOOGLE_CLIENT_SECRET,
// PHOTO_CALENDAR_OWNER_EMAIL, PHOTO_CALENDAR_TOKEN_KEY (32 random bytes, base64url).
// Google redirect URI: https://rickparma.com/api/photo-calendar/callback

const ORIGIN="https://rickparma.com";
const CALENDAR="ee79e1557e817dd0e6986fac5545e97cf36f3a9537862731c7e9adc12ea58186@group.calendar.google.com";
const CALLBACK=ORIGIN+"/api/photo-calendar/callback";
const AUTH_SCOPE="openid email https://www.googleapis.com/auth/calendar.events";
const SESSION_COOKIE="__Host-rp_calendar_session";
const STATE_COOKIE="__Host-rp_calendar_oauth_state";
const SESSION_MS=60*24*60*60*1000;
const STATE_MS=10*60*1000;
let initialized=false;
function response(body,status=200,headers={}) {
  return new Response(JSON.stringify(body),{status,headers:{
    "content-type":"application/json; charset=utf-8","cache-control":"no-store",
    "x-content-type-options":"nosniff",...headers
  }});
}
function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function un64(value) {
  // Accept both padded standard Base64 (openssl rand -base64 32) and base64url.
  const str=String(value||"").trim().replace(/=+$/,"");
  if(!/^[A-Za-z0-9+/_-]{1,8192}$/.test(str)) throw new Error("Invalid encoded value");
  const normalized=str.replace(/-/g,"+").replace(/_/g,"/");
  const bytes=atob(normalized+"=".repeat((4-normalized.length%4)%4));
  return Uint8Array.from(bytes,c=>c.charCodeAt(0));
}
function random(size=32){return b64(crypto.getRandomValues(new Uint8Array(size)));}
async function hash(value){return b64(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));}
function cookie(request,name){
  const part=(request.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="));
  return part?part.slice(name.length+1):"";
}
function cookieHeader(name,value,seconds){
  return name+"="+value+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age="+seconds;
}
function configured(env) {
  return Boolean(env.PAYMENT_DB && env.PHOTO_CALENDAR_GOOGLE_CLIENT_ID &&
    env.PHOTO_CALENDAR_GOOGLE_CLIENT_SECRET && env.PHOTO_CALENDAR_OWNER_EMAIL &&
    env.PHOTO_CALENDAR_TOKEN_KEY);
}
async function setup(db) {
  if(initialized)return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS rp_calendar_oauth_credentials (id INTEGER PRIMARY KEY CHECK(id=1), refresh_cipher TEXT NOT NULL, google_subject TEXT NOT NULL, owner_email TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS rp_calendar_oauth_states (state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS rp_calendar_oauth_sessions (session_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)")
  ]);
  initialized=true;
}
async function cryptoKey(secret){
  const raw=un64(secret);
  if(raw.byteLength!==32)throw new Error("Invalid encryption key");
  return crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function encryptToken(token,secret){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const payload=await crypto.subtle.encrypt({name:"AES-GCM",iv},await cryptoKey(secret),new TextEncoder().encode(token));
  return b64(iv)+"."+b64(payload);
}
async function decryptToken(blob,secret){
  const parts=String(blob||"").split(".");
  if(parts.length!==2)throw new Error("Invalid stored Google connection");
  return new TextDecoder().decode(await crypto.subtle.decrypt(
    {name:"AES-GCM",iv:un64(parts[0])},await cryptoKey(secret),un64(parts[1])
  ));
}
async function validSession(request,db){
  const token=cookie(request,SESSION_COOKIE);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))return false;
  return Boolean(await db.prepare("SELECT 1 FROM rp_calendar_oauth_sessions WHERE session_hash=? AND expires_at>?")
    .bind(await hash(token),Date.now()).first());
}
async function tokenRequest(params){
  const res=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams(params).toString()
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data.error){
    const error=new Error(data.error==="invalid_grant"?
      "Google background authorization expired. Reconnect Google once in Photo Manager Settings.":
      "Google authorization failed. Connect again in Photo Manager Settings.");
    error.status=401;throw error;
  }
  return data;
}
async function accessToken(env){
  const record=await env.PAYMENT_DB.prepare("SELECT refresh_cipher FROM rp_calendar_oauth_credentials WHERE id=1").first();
  if(!record?.refresh_cipher)throw Object.assign(new Error("Connect Google once in Photo Manager Settings."),{status:401});
  const refresh=await decryptToken(record.refresh_cipher,env.PHOTO_CALENDAR_TOKEN_KEY);
  let data;
  try {
    data=await tokenRequest({grant_type:"refresh_token",refresh_token:refresh,
      client_id:env.PHOTO_CALENDAR_GOOGLE_CLIENT_ID,client_secret:env.PHOTO_CALENDAR_GOOGLE_CLIENT_SECRET});
  } catch(error) {
    if(error.status===401) {
      // Invalid offline permission must terminate browser sessions. Otherwise
      // /status would misleadingly show an unusable connection.
      await env.PAYMENT_DB.prepare("DELETE FROM rp_calendar_oauth_sessions").run();
    }
    throw error;
  }
  if(!data.access_token)throw Object.assign(new Error("Google access token was unavailable."),{status:502});
  if(data.refresh_token && data.refresh_token!==refresh){
    const newCipher=await encryptToken(data.refresh_token,env.PHOTO_CALENDAR_TOKEN_KEY);
    await env.PAYMENT_DB.prepare("UPDATE rp_calendar_oauth_credentials SET refresh_cipher=?,updated_at=? WHERE id=1")
      .bind(newCipher,Date.now()).run();
  }
  return data.access_token;
}
async function connect(env){
  const state=random(),verifier=random(64);
  await env.PAYMENT_DB.prepare("DELETE FROM rp_calendar_oauth_states WHERE expires_at<?").bind(Date.now()).run();
  await env.PAYMENT_DB.prepare("INSERT INTO rp_calendar_oauth_states(state_hash,verifier,expires_at) VALUES(?,?,?)")
    .bind(await hash(state),verifier,Date.now()+STATE_MS).run();
  const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id",env.PHOTO_CALENDAR_GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri",CALLBACK);
  url.searchParams.set("response_type","code");
  url.searchParams.set("access_type","offline");
  url.searchParams.set("prompt","consent");
  url.searchParams.set("scope",AUTH_SCOPE);
  url.searchParams.set("state",state);
  url.searchParams.set("code_challenge",await hash(verifier));
  url.searchParams.set("code_challenge_method","S256");
  return new Response(null,{status:302,headers:{
    location:url.toString(),"cache-control":"no-store",
    "set-cookie":cookieHeader(STATE_COOKIE,state,STATE_MS/1000)
  }});
}
async function callback(request,env){
  const url=new URL(request.url),state=url.searchParams.get("state")||"",given=cookie(request,STATE_COOKIE);
  if(!/^[A-Za-z0-9_-]{43}$/.test(state)||state!==given){
    return response({error:"Google connection state did not match. Reconnect from Photo Manager."},400);
  }
  const pending=await env.PAYMENT_DB.prepare(
    "DELETE FROM rp_calendar_oauth_states WHERE state_hash=? RETURNING verifier,expires_at"
  ).bind(await hash(state)).first();
  if(!pending||pending.expires_at<=Date.now())return response({error:"Google connection expired; try again."},400);
  const code=url.searchParams.get("code")||"";
  if(!code||code.length>4096||url.searchParams.has("error"))return response({error:"Google connection was not approved."},400);
  const data=await tokenRequest({grant_type:"authorization_code",code,
    client_id:env.PHOTO_CALENDAR_GOOGLE_CLIENT_ID,
    client_secret:env.PHOTO_CALENDAR_GOOGLE_CLIENT_SECRET,
    code_verifier:pending.verifier,redirect_uri:CALLBACK});
  if(!data.refresh_token||!data.access_token)return response({error:"Google did not issue background permission. Reconnect and approve Calendar access."},400);
  const profileResponse=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{
    headers:{authorization:"Bearer "+data.access_token}
  });
  const profile=await profileResponse.json().catch(()=>({}));
  const owner=String(env.PHOTO_CALENDAR_OWNER_EMAIL||"").trim().toLowerCase();
  if(!profileResponse.ok||profile.email_verified!==true||!profile.sub||
     String(profile.email||"").toLowerCase()!==owner){
    return response({error:"This Google account isn't authorized for Photo Manager."},403);
  }
  const encrypted=await encryptToken(data.refresh_token,env.PHOTO_CALENDAR_TOKEN_KEY);
  await env.PAYMENT_DB.prepare(
    "INSERT INTO rp_calendar_oauth_credentials(id,refresh_cipher,google_subject,owner_email,updated_at) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET refresh_cipher=excluded.refresh_cipher,google_subject=excluded.google_subject,owner_email=excluded.owner_email,updated_at=excluded.updated_at"
  ).bind(encrypted,profile.sub,owner,Date.now()).run();
  const session=random();
  await env.PAYMENT_DB.prepare("DELETE FROM rp_calendar_oauth_sessions WHERE expires_at<?").bind(Date.now()).run();
  await env.PAYMENT_DB.prepare("INSERT INTO rp_calendar_oauth_sessions(session_hash,expires_at) VALUES(?,?)")
    .bind(await hash(session),Date.now()+SESSION_MS).run();
  return new Response(null,{status:302,headers:{
    location:ORIGIN+"/photo-manager?google_calendar=connected",
    "cache-control":"no-store","set-cookie":cookieHeader(SESSION_COOKIE,session,SESSION_MS/1000)
  }});
}
function validateEvent(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw Object.assign(new Error("Invalid event."),{status:400});
  const summary=String(value.summary||"").trim(),location=String(value.location||"").trim(),description=String(value.description||"").trim();
  if(!summary||summary.length>200||location.length>500||description.length>12000)throw Object.assign(new Error("Invalid event fields."),{status:400});
  const dateOK=s=>typeof s==="string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+"T12:00:00Z"));
  const timeOK=s=>typeof s==="string" && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(s);
  const allDay=dateOK(value.start?.date)&&dateOK(value.end?.date);
  const timed=timeOK(value.start?.dateTime)&&timeOK(value.end?.dateTime)&&
    value.start.timeZone==="America/Los_Angeles"&&value.end.timeZone==="America/Los_Angeles";
  if(!allDay&&!timed)throw Object.assign(new Error("Invalid event date or time."),{status:400});
  return {summary,location,description,start:value.start,end:value.end};
}
async function changeEvent(request,env,method,id){
  if(new URL(request.url).origin!==ORIGIN||request.headers.get("origin")!==ORIGIN){
    return response({error:"Calendar edits must come from Photo Manager."},403);
  }
  if(!await validSession(request,env.PAYMENT_DB)){
    return response({error:"Google session expired. Reconnect once in Photo Manager Settings."},401);
  }
  let payload;
  if(method!=="DELETE"){
    let parsed;try{parsed=await request.json()}catch{return response({error:"Invalid event request."},400)}
    payload=validateEvent(parsed);
  }
  const token=await accessToken(env);
  const endpoint=new URL("https://www.googleapis.com/calendar/v3/calendars/"+encodeURIComponent(CALENDAR)+"/events"+(id?"/"+encodeURIComponent(id):""));
  endpoint.searchParams.set("sendUpdates","none");
  const google=await fetch(endpoint.toString(),{
    method,headers:{authorization:"Bearer "+token,...(method==="DELETE"?{}:{"content-type":"application/json"})},
    ...(method==="DELETE"?{}:{body:JSON.stringify(payload)})
  });
  if(google.ok){
    if(method==="DELETE")return response({ok:true});
    const saved=await google.json();
    return response({ok:true,id:saved.id,htmlLink:saved.htmlLink});
  }
  const data=await google.json().catch(()=>({}));
  if(google.status===401||google.status===403)return response({error:"Google Calendar needs reconnection in Settings."},401);
  return response({error:data.error?.message||"Google Calendar could not save this event."},google.status>=500?502:400);
}
async function handle(request,env){
  const url=new URL(request.url),route=url.pathname.slice("/api/photo-calendar/".length),method=request.method.toUpperCase();
  if(!configured(env)){
    return response({configured:false,connected:false,
      error:"Background Calendar connection needs Cloudflare secret configuration."},
      method==="GET"&&route==="status"?200:503);
  }
  await setup(env.PAYMENT_DB);
  if(method==="GET"&&route==="status")return response({configured:true,connected:await validSession(request,env.PAYMENT_DB)});
  if(method==="GET"&&route==="connect")return connect(env);
  if(method==="GET"&&route==="callback")return callback(request,env);
  if(method==="POST"&&route==="events")return changeEvent(request,env,"POST",null);
  const match=route.match(/^events\/([A-Za-z0-9_-]{1,256})$/);
  if(match&&(method==="PATCH"||method==="DELETE"))return changeEvent(request,env,method,match[1]);
  return response({error:"Not found."},404);
}
async function entry(request,env){
  try{return await handle(request,env)}
  catch(error){
    // Never expose OAuth secrets, token values or upstream response bodies.
    const status=error?.status||500;
    return response({error:status<500?error.message:"Calendar connection temporarily unavailable."},status);
  }
}
export const onRequestGet=({request,env})=>entry(request,env);
export const onRequestPost=({request,env})=>entry(request,env);
export const onRequestPatch=({request,env})=>entry(request,env);
export const onRequestDelete=({request,env})=>entry(request,env);
