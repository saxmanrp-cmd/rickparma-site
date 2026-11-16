(function(){
  'use strict';

  const SUBMIT_LOCK_MS = 4 * 60 * 60 * 1000;
  const activeSubmissions = new Set();
  let spinOutcomePending = false;
  let freeSpinToken = null;

  function submitKey(songId){
    return 'rp_song_submit_' + songId;
  }

  function recentlySubmitted(songId){
    try{
      const ts = Number(localStorage.getItem(submitKey(songId)) || 0);
      return ts > 0 && (Date.now() - ts) < SUBMIT_LOCK_MS;
    }catch(_){
      return false;
    }
  }

  function rememberSubmitted(songId){
    try{ localStorage.setItem(submitKey(songId), String(Date.now())); }catch(_){}
  }

  function disableSubmitButton(el, text){
    if(!el) return;
    el.dataset.requestSubmitting = '1';
    el.setAttribute('aria-disabled','true');
    el.style.pointerEvents = 'none';
    el.style.opacity = '.7';
    el.textContent = text || 'Sending...';
  }

  function addBackLink(el){
    if(!el || document.getElementById('requestBackHome')) return;
    const w = document.createElement('div');
    w.id = 'requestBackHome';
    w.style.cssText = 'margin-top:18px;text-align:center;';
    w.innerHTML = '<a href="https://rickparma.com" target="_top" style="display:inline-block;padding:16px 30px;background:var(--accent);color:#0c1420;font-weight:900;font-size:18px;border-radius:14px;text-decoration:none;letter-spacing:0.3px;">&larr; Back to RickParma.com</a>';
    (el.closest('.spin-result') || el.parentElement || el).insertAdjacentElement('afterend', w);
  }

  // Replace the original FREE-request sender with an immediate, one-shot guard.
  // The first tap locks the control before any network work begins, so repeated
  // taps cannot create multiple request records or multiple text alerts.
  window.prepareSend = async function(el, id, outcomeType){
    const s = songs.find(x => x.id === id);
    if(!s) return false;

    if(!el || el.dataset.requestSubmitting === '1' || activeSubmissions.has(id) || recentlySubmitted(id) || (typeof isLocked === 'function' && isLocked(id))){
      if(el){
        disableSubmitButton(el, 'Request already sent');
      }
      return false;
    }

    activeSubmissions.add(id);
    disableSubmitButton(el, 'Sending...');

    const enteredName = document.getElementById('reqName') ? document.getElementById('reqName').value.trim() : '';
    const name = enteredName || 'Someone';
    const outcome = outcomeType || 'FREE';
    const entry = {
      id: 'r' + Date.now() + Math.random().toString(36).slice(2,7),
      name,
      song: s.t,
      artist: s.a || '',
      outcome,
      ts: Date.now()
    };

    try{
      if(typeof smsRequestsEnabled === 'undefined' || smsRequestsEnabled){
        const response = await fetch('/api/song-free-alert', {
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({token:freeSpinToken,songId:id,name:enteredName})
        });
        if(!response.ok) throw new Error('Free request alert failed');
      }
      rememberSubmitted(id);
      if(typeof markRequested === 'function') await markRequested(id);
      if(typeof logSongRequest === 'function') await logSongRequest(entry);
    }catch(err){
      console.error('Song request submit failed', err);
      activeSubmissions.delete(id);
      if(el){ el.dataset.requestSubmitting = '0'; el.removeAttribute('aria-disabled'); el.style.pointerEvents = ''; el.style.opacity = ''; el.textContent = 'Could not send — try again'; }
      return false;
    }

    if(el){
      el.textContent = 'Thanks for the request!';
      el.style.pointerEvents = 'none';
      el.style.opacity = '.7';
      addBackLink(el);
    }
    return false;
  };

  // Paid requests need the exact song IDs to survive the trip through checkout.
  // Add them to every song-payment link immediately before navigation. The
  // Payment Hub already stores songRequestId in intent metadata, and the paid
  // lock endpoint uses it only after the intent has actually reached PAID.
  function normalizeLabel(value){
    return String(value || '').trim().replace(/\s+/g,' ').toLowerCase();
  }

  function songLabel(song){
    return `${song.t || ''}${song.a ? ' - ' + song.a : ''}`.trim();
  }

  function idsForPaidLabel(value){
    if(!Array.isArray(window.songs || songs)) return [];
    const parts = String(value || '').split(/\s+\+\s+BOGO:\s+/i).map(x => normalizeLabel(x)).filter(Boolean);
    const ids = [];
    parts.forEach(function(part){
      const match = songs.find(function(song){ return normalizeLabel(songLabel(song)) === part; }) ||
                    songs.find(function(song){ return normalizeLabel(song.t) === part; });
      if(match && match.id && !ids.includes(String(match.id))) ids.push(String(match.id));
    });
    return ids;
  }

  document.addEventListener('click', function(event){
    const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if(!link) return;
    try{
      const url = new URL(link.href, location.href);
      if(url.searchParams.get('mode') !== 'song' || !url.searchParams.get('song')) return;
      const enteredName = document.getElementById('reqName')?.value.trim();
      if(enteredName && !url.searchParams.has('name')) url.searchParams.set('name', enteredName);
      const ids = idsForPaidLabel(url.searchParams.get('song'));
      if(ids.length && !url.searchParams.has('songRequestId')){
        url.searchParams.set('songRequestId', ids.join(','));
      }
      link.href = url.toString();
    }catch(_){}
  }, true);

  // The server assigns the shared ten-request cycle and enforces one spin per
  // phone per gig. The animation consumes that result; it never chooses it.
  const originalSpinWheel = window.spinWheel;
  if(typeof originalSpinWheel === 'function'){
    window.spinWheel = async function(songId, price){
      if(spinOutcomePending) return;

      spinOutcomePending = true;
      const btn = document.getElementById('spinBtn');
      if(btn){
        btn.disabled = true;
        btn.style.opacity = '.68';
        btn.textContent = 'SPINNING…';
      }

      let outcome;
      try{
        let deviceId = localStorage.getItem('rp_spinDeviceId');
        if(!deviceId){deviceId=crypto.randomUUID();localStorage.setItem('rp_spinDeviceId',deviceId);}
        const requestKey='rp_spinPending_'+spinCycleId;
        let requestId=localStorage.getItem(requestKey);
        if(!requestId){requestId=crypto.randomUUID();localStorage.setItem(requestKey,requestId);}
        const res = await fetch('/api/song-spin', {
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({songId,deviceId,requestId}),
          cache:'no-store'
        });
        if(!res.ok) throw new Error('song-spin ' + res.status);
        const data = await res.json();
        if(!['FREE','BOGO','PAID'].includes(data.outcome)) throw new Error('Invalid song-spin outcome');
        if(data.cycleId !== spinCycleId) throw new Error('The show reset. Please try again.');
        if(data.outcome === 'FREE' && !data.token) throw new Error('Missing free-spin token');
        freeSpinToken = data.outcome === 'FREE' ? data.token : null;
        outcome = data.outcome;
        localStorage.removeItem(requestKey);
      }catch(err){
        console.error('Controlled song spin failed', err);
        if(btn){btn.disabled=false;btn.style.opacity='1';btn.textContent='TRY SPIN AGAIN';}
        const status=document.getElementById('rouletteVideoStatus');
        if(status)status.textContent='Could not reach the spin service. Please try again.';
        spinOutcomePending=false;
        return;
      }

      if(outcome === 'PAID'){
        lockSpinForThisDevice();
        spinOutcomePending=false;
        if(typeof window.playPaidSpin === 'function') window.playPaidSpin(songId,price);
        else skipSpinToPayment(songId,price);
        return;
      }

      const originalRandom = Math.random;
      Math.random = outcome === 'FREE' ? function(){ return 0.01; } : function(){ return 0.99; };
      try{
        return originalSpinWheel.call(this, songId, price, true);
      }finally{
        Math.random = originalRandom;
        spinOutcomePending = false;
      }
    };
  }
})();
