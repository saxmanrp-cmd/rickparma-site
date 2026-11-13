import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { signInvoice } from '../functions/api/[[path]].js';

test('signed invoices text Rick once per signed date across both profiles', async () => {
  const sql = new DatabaseSync(':memory:');
  const env = { SMS_BLAST_ADMIN_TOKEN:'server-token', TIP_NOTIFICATION_PHONE:'7732091124',
    PAYMENT_DB:{ prepare(query) { const statement = sql.prepare(query); return {
      bind(...values) { return {
        async run() { return { meta:{ changes:statement.run(...values).changes } }; }
      }; }, async run() { return statement.run(); }
    }; } } };
  let invoices = [
    { id:'personal', invoiceNumber:1001, clientName:'Personal Client' },
    { id:'business', profileId:'parma-entertainment-group-llc', invoiceNumber:2001,
      clientName:'Business Client', events:[{dateId:'day-1',eventDate:'2026-12-01'},
        {dateId:'day-2',eventDate:'2026-12-02'}] }
  ];
  const messages = [];
  let puts = 0;
  const fetcher = async (url, options = {}) => {
    if (url.includes('/invoices')) {
      if (options.method === 'PUT') {
        puts++; invoices = structuredClone(JSON.parse(options.body).invoices);
        return Response.json({ ok:true });
      }
      return Response.json({ record:{ invoices:structuredClone(invoices) } });
    }
    assert.equal(options.headers['X-Admin-Token'], 'server-token');
    messages.push(JSON.parse(options.body));
    return Response.json({ ok:true });
  };
  const sign = async (invoiceId, profileId, dateId = null) => signInvoice(new Request('https://rickparma.com/api/invoices/sign', {
    method:'POST', body:JSON.stringify({ invoiceId, profileId, dateId, name:'Jane Client',
      date:'2026-11-13', signature:'data:image/png;base64,AAAA' })
  }), env, fetcher);

  assert.equal((await sign('personal','rick-parma')).status, 200);
  assert.equal((await sign('personal','rick-parma')).status, 200);
  assert.equal(puts, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].phone, '+17732091124');
  assert.match(messages[0].message, /Invoice #1001 was signed by Jane Client/);
  assert.equal((await sign('business','rick-parma','day-1')).status, 404);
  assert.equal((await sign('business','parma-entertainment-group-llc','bad-date')).status, 404);
  assert.equal((await sign('business','parma-entertainment-group-llc','day-1')).status, 200);
  assert.equal((await sign('business','parma-entertainment-group-llc','day-2')).status, 200);
  assert.equal(messages.length, 3);
  assert.match(messages[1].message, /Invoice #2001 for 2026-12-01/);
  assert.match(messages[2].message, /Invoice #2001 for 2026-12-02/);
  assert.equal(Object.keys(invoices[1].dateSignatures).length, 2);
  sql.close();
});
