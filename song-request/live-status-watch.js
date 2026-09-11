(function(){
  'use strict';

  const PROXY_BASE = 'https://rickparma-jsonbin-proxy.saxmanrp.workers.dev';
  const POLL_MS = 3000;
  let requestsClosed = false;
  let checking = false;
  let previousBodyOverflow = '';

  function ensureUi(){
    if(document.getElementById('songRequestsClosedOverlay')) return;

    const style = document.createElement('style');
    style.id = 'songRequestsClosedStyles';
    style.textContent = `
      #songRequestsClosedOverlay{
        position:fixed;
        inset:0;
        z-index:2147483647;
        display:none;
        align-items:center;
        justify-content:center;
        padding:24px;
        background:
          radial-gradient(circle at 20% 12%,rgba(65,211,255,.16),transparent 30%),
          radial-gradient(circle at 82% 14%,rgba(241,77,222,.12),transparent 32%),
          linear-gradient(180deg,#02040a 0%,#05070d 55%,#020309 100%);
        color:#f5f7fb;
        font-family:'Lato',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        text-align:center;
        overscroll-behavior:none;
      }
      #songRequestsClosedOverlay.show{display:flex;}
      #songRequestsClosedOverlay .sr-closed-card{
        width:min(100%,520px);
        padding:34px 24px 28px;
        border:1px solid rgba(187,214,241,.28);
        border-radius:28px;
        background:linear-gradient(180deg,rgba(17,25,39,.95),rgba(5,9,16,.98));
        box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 28px 80px rgba(0,0,0,.52),0 0 40px rgba(70,210,255,.07);
      }
      #songRequestsClosedOverlay .sr-closed-icon{
        width:72px;
        height:72px;
        margin:0 auto 18px;
        display:flex;
        align-items:center;
        justify-content:center;
        border-radius:50%;
        border:1px solid rgba(112,222,255,.45);
        background:linear-gradient(180deg,rgba(24,54,73,.95),rgba(7,21,32,.98));
        font-size:34px;
        box-shadow:0 0 28px rgba(72,211,255,.13);
      }
      #songRequestsClosedOverlay .sr-closed-eyebrow{
        margin-bottom:10px;
        color:#82e5ff;
        font-size:12px;
        font-weight:900;
        letter-spacing:.18em;
        text-transform:uppercase;
      }
      #songRequestsClosedOverlay h1{
        margin:0;
        color:#fff;
        font-family:'Josefin Sans',system-ui,sans-serif;
        font-size:clamp(2rem,9vw,3.25rem);
        font-weight:900;
        line-height:.98;
        letter-spacing:.02em;
      }
      #songRequestsClosedOverlay p{
        max-width:420px;
        margin:18px auto 0;
        color:#b8c2d0;
        font-size:16px;
        font-weight:700;
        line-height:1.55;
      }
      #songRequestsClosedOverlay .sr-closed-thanks{
        margin-top:15px;
        color:#eef3f8;
        font-size:17px;
        font-weight:900;
      }
      #songRequestsClosedOverlay a{
        display:block;
        width:100%;
        margin-top:26px;
        padding:16px 18px;
        border:1px solid rgba(222,235,249,.55);
        border-radius:18px;
        background:linear-gradient(100deg,#54ddff 0%,#718fff 49%,#df76dc 100%);
        color:#040714;
        font-size:16px;
        font-weight:900;
        letter-spacing:.025em;
        text-decoration:none;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.62),0 10px 26px rgba(65,197,255,.15);
      }
      @media(max-width:480px){
        #songRequestsClosedOverlay{padding:18px;}
        #songRequestsClosedOverlay .sr-closed-card{padding:30px 19px 23px;border-radius:24px;}
      }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'songRequestsClosedOverlay';
    overlay.setAttribute('role','alertdialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-labelledby','songRequestsClosedTitle');
    overlay.innerHTML = `
      <div class="sr-closed-card">
        <div class="sr-closed-icon">🎤</div>
        <div class="sr-closed-eyebrow">Tonight's requests are closed</div>
        <h1 id="songRequestsClosedTitle">SONG REQUESTS ARE NOW OVER</h1>
        <p>Rick has closed song requests for the rest of the show, so no additional requests can be submitted right now.</p>
        <div class="sr-closed-thanks">Thanks for hanging out and enjoying the music!</div>
        <a href="https://rickparma.com/" target="_top">Back to RickParma.com</a>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  function showClosed(){
    ensureUi();
    if(requestsClosed) return;
    requestsClosed = true;
    previousBodyOverflow = document.body.style.overflow || '';
    document.body.style.overflow = 'hidden';
    const overlay = document.getElementById('songRequestsClosedOverlay');
    if(overlay) overlay.classList.add('show');

    const rouletteVideo = document.getElementById('rouletteVideo');
    if(rouletteVideo){
      try{ rouletteVideo.pause(); }catch(_){}
    }
  }

  function showOpen(){
    if(!requestsClosed) return;
    requestsClosed = false;
    const overlay = document.getElementById('songRequestsClosedOverlay');
    if(overlay) overlay.classList.remove('show');
    document.body.style.overflow = previousBodyOverflow;
  }

  async function checkStatus(){
    if(checking) return;
    checking = true;
    try{
      const res = await fetch(`${PROXY_BASE}/songs`, { cache:'no-store' });
      if(!res.ok) throw new Error('status ' + res.status);
      const data = await res.json();
      const record = (data && data.record) || {};
      if(record.songRequestLive === false) showClosed();
      else showOpen();
    }catch(err){
      console.warn('Song request live-status check failed', err);
    }finally{
      checking = false;
    }
  }

  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible') checkStatus();
  });
  window.addEventListener('focus', checkStatus);

  document.addEventListener('click', function(event){
    if(!requestsClosed) return;
    const overlay = document.getElementById('songRequestsClosedOverlay');
    if(overlay && !overlay.contains(event.target)){
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  ensureUi();
  checkStatus();
  setInterval(checkStatus, POLL_MS);
})();
