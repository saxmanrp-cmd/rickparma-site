import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { onRequest } from '../functions/api/[[path]].js';
import { onRequestGet as listPayHubTransactions } from '../functions/api/admin/transactions.js';

test('Pay Hub lists completed requests and excludes abandoned checkouts from totals and pages', async () => {
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE payment_intents (id TEXT, type TEXT, status TEXT, amount_cents INTEGER,
    currency TEXT, metadata_json TEXT, created_at TEXT, paid_at TEXT, provider TEXT, provider_payment_id TEXT);
    CREATE TABLE payment_events (intent_id TEXT, event_type TEXT, provider TEXT, payload_json TEXT, created_at TEXT);
    INSERT INTO payment_intents VALUES
      ('open-dj','song_request','OPEN',1200,'USD','{}','2026-11-15T12:00:00Z',NULL,NULL,NULL),
      ('unverified-song','song_request','PAID',2000,'USD','{}','2026-11-15T11:30:00Z','2026-11-15T11:31:00Z',NULL,NULL),
      ('paid-dj','song_request','PAID',1200,'USD','{"requestType":"dj"}','2026-11-15T11:00:00Z','2026-11-15T11:05:00Z','square','square-payment-1'),
      ('paid-tip','tip','PAID',500,'USD','{}','2026-11-15T10:00:00Z','2026-11-15T10:05:00Z','square','square-payment-2');`);
  const env={ADMIN_API_KEY:'test-key',PAYMENT_DB:{prepare(query){return {
    bind(...values){const stmt=sql.prepare(query);return {
      async all(){return {results:stmt.all(...values)};},async first(){return stmt.get(...values);}
    };}, async first(){return sql.prepare(query).get();}
  };}}};
  try {
    const request=new Request('https://rickparma.com/api/admin/transactions?limit=1&offset=0',
      {headers:{authorization:'Bearer test-key'}});
    const first=await (await onRequest({request,env})).json();
    assert.equal(first.total,2);
    assert.deepEqual(first.transactions.map(t=>t.id),['paid-dj']);
    const next=new Request('https://rickparma.com/api/admin/transactions?limit=1&offset=1',
      {headers:{authorization:'Bearer test-key'}});
    const second=await (await onRequest({request:next,env})).json();
    assert.deepEqual(second.transactions.map(t=>t.id),['paid-tip']);
  } finally {sql.close();}
});

test('the deployed Pay Hub route excludes an old unpaid Stevie Wonder request', async () => {
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE payment_intents (id TEXT, type TEXT, status TEXT, amount_cents INTEGER,
    currency TEXT, description TEXT, created_at TEXT, paid_at TEXT, provider TEXT, provider_payment_id TEXT);
    CREATE TABLE payment_events (intent_id TEXT, payload_json TEXT, created_at TEXT);
    INSERT INTO payment_intents VALUES
      ('stevie','song_request','OPEN',2000,'USD','Superstition - Stevie Wonder','2026-11-13T21:32:00Z',NULL,NULL,NULL),
      ('bad-paid','song_request','PAID',2000,'USD','Unverified request','2026-11-13T21:33:00Z','2026-11-13T21:34:00Z',NULL,NULL),
      ('good','song_request','PAID',2000,'USD','Paid request','2026-11-13T21:50:00Z','2026-11-13T21:51:00Z','square','payment-1');`);
  const env={ADMIN_API_KEY:'test-key',PAYMENT_DB:{prepare(query){return {
    bind(...values){const stmt=sql.prepare(query);return {async all(){return {results:stmt.all(...values)}}};},
    async first(){return sql.prepare(query).get();}
  };}}};
  try {
    const request=new Request('https://rickparma.com/api/admin/transactions?limit=1',
      {headers:{authorization:'Bearer test-key'}});
    const response=await listPayHubTransactions({request,env});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.total,1);
    assert.deepEqual(result.transactions.map(tx=>tx.id),['good']);
  } finally {sql.close();}
});
