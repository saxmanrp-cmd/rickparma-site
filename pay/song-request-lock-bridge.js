(function(){
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const tried = new Set();

  function parseIntentId(init){
    try{
      if(!init || !init.body) return '';
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      return body && body.intentId ? String(body.intentId) : '';
    }catch(_){ return ''; }
  }

  async function lockPaidSong(intentId, attempt){
    if(!intentId) return;
    const key = intentId + ':' + attempt;
    if(tried.has(key)) return;
    tried.add(key);

    try{
      const res = await nativeFetch('/api/song-request-lock', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({intentId}),
        cache:'no-store'
      });

      if(res.status === 202 && attempt < 4){
        setTimeout(function(){ lockPaidSong(intentId, attempt + 1); }, 1200 * (attempt + 1));
      }
    }catch(_){
      if(attempt < 3){
        setTimeout(function(){ lockPaidSong(intentId, attempt + 1); }, 1500 * (attempt + 1));
      }
    }
  }

  window.fetch = async function(input, init){
    const response = await nativeFetch(input, init);

    try{
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const isPaymentConfirmation =
        url.includes('/api/square/pay') ||
        url.includes('/api/paypal/capture-order') ||
        /\/api\/paypal\/orders\/[^/]+\/capture/.test(url);

      if(response.ok && isPaymentConfirmation){
        const intentId = parseIntentId(init);
        if(intentId) setTimeout(function(){ lockPaidSong(intentId, 0); }, 0);
      }
    }catch(_){}

    return response;
  };

  // Cash App and some wallet flows can return to checkout after payment.
  // The server verifies that the intent is actually PAID before locking anything.
  try{
    const resumedIntent = new URLSearchParams(location.search).get('intent');
    if(resumedIntent) setTimeout(function(){ lockPaidSong(resumedIntent, 0); }, 500);
  }catch(_){}
})();
