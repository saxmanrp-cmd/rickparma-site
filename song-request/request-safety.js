(function(){
  'use strict';

  const SUBMIT_LOCK_MS = 4 * 60 * 60 * 1000;
  const activeSubmissions = new Set();
  let spinOutcomePending = false;

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
    rememberSubmitted(id);
    disableSubmitButton(el, 'Sending...');

    const name = (document.getElementById('reqName') ? document.getElementById('reqName').value.trim() : '') || 'Someone';
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
      // Mark the song requested first so the shared four-hour lock begins as
      // soon as the submission starts, then append exactly one request record.
      if(typeof markRequested === 'function') await markRequested(id);
      if(typeof logSongRequest === 'function') await logSongRequest(entry);

      if(typeof smsRequestsEnabled === 'undefined' || smsRequestsEnabled){
        const p = new URLSearchParams();
        p.append('name', name);
        p.append('song', s.t);
        p.append('artist', s.a || '');
        p.append('outcome', outcome);
        await fetch('https://rickparma-booking-8582.twil.io/song-alert', {
          method:'POST',
          mode:'no-cors',
          body:p
        }).catch(function(){});
      }
    }catch(err){
      console.error('Song request submit failed', err);
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
      if(url.searchParams.get('songRequestId')) return;
      const ids = idsForPaidLabel(url.searchParams.get('song'));
      if(ids.length){
        url.searchParams.set('songRequestId', ids.join(','));
        link.href = url.toString();
      }
    }catch(_){}
  }, true);

  // The original roulette code used Math.random() < 1/7 on every spin. That is
  // a 1-in-7 probability, not a one-per-seven limit. Ask the server for the next
  // position in a shared seven-spin cycle, then feed that controlled outcome into
  // the existing roulette animation/video code without rewriting the UI flow.
  const originalSpinWheel = window.spinWheel;
  if(typeof originalSpinWheel === 'function'){
    window.spinWheel = async function(songId, price){
      if(spinOutcomePending) return;

      if(typeof getSpinLockRemainingMs === 'function' && getSpinLockRemainingMs() > 0){
        return originalSpinWheel.call(this, songId, price);
      }

      spinOutcomePending = true;
      const btn = document.getElementById('spinBtn');
      if(btn){
        btn.disabled = true;
        btn.style.opacity = '.68';
        btn.textContent = 'SPINNING…';
      }

      let outcome = 'BOGO';
      try{
        const res = await fetch('/api/song-spin', {
          method:'POST',
          headers:{'content-type':'application/json'},
          cache:'no-store'
        });
        if(!res.ok) throw new Error('song-spin ' + res.status);
        const data = await res.json();
        if(data.outcome !== 'FREE' && data.outcome !== 'BOGO') throw new Error('Invalid song-spin outcome');
        outcome = data.outcome;
      }catch(err){
        // Fail closed: if the server cannot be reached, never accidentally give
        // away an extra FREE request. The guest still gets the BOGO path.
        console.error('Controlled song spin failed; using BOGO fallback', err);
        outcome = 'BOGO';
      }

      const originalRandom = Math.random;
      Math.random = outcome === 'FREE' ? function(){ return 0.01; } : function(){ return 0.99; };
      try{
        return originalSpinWheel.call(this, songId, price);
      }finally{
        Math.random = originalRandom;
        spinOutcomePending = false;
      }
    };
  }
})();
