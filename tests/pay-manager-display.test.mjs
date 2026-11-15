import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('Pay Hub display excludes an unverified song even if a stale API lists it as paid', () => {
  const code=fs.readFileSync(new URL('../pay-manager/app.js',import.meta.url),'utf8');
  const definition=code.match(/function isVerifiedSale\(tx\)\{[^}]+\}/)?.[0];
  assert.ok(definition);
  const isVerifiedSale=vm.runInNewContext(`${definition}; isVerifiedSale`);
  assert.equal(isVerifiedSale({type:'song_request',status:'PAID',amountCents:2000,description:'Superstition - Stevie Wonder'}),false);
  assert.equal(isVerifiedSale({type:'song_request',status:'OPEN',provider:'square',providerPaymentId:'id-1'}),false);
  assert.equal(isVerifiedSale({type:'song_request',status:'PAID',provider:'square',providerPaymentId:'id-1'}),true);
  assert.equal(isVerifiedSale({type:'song_request',status:'PAID',provider:'paypal',providerPaymentId:'capture-1'}),true);
  assert.equal(isVerifiedSale({type:'tip',status:'PAID',provider:'square'}),true);
});
