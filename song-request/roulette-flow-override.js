(function(){
  const FREE_VIDEO='./video/roulette-free.mp4';
  const BOGO_VIDEO='./video/roulette-bogo.mp4';

  const style=document.createElement('style');
  style.textContent=`
    .roulette-video-card{margin-top:14px;}
    .roulette-video-stage{position:relative;width:min(100%,520px);aspect-ratio:2/3;max-height:68vh;margin:14px auto 0;border-radius:22px;overflow:hidden;border:1px solid rgba(178,210,238,.27);background:#02040a;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 16px 38px rgba(0,0,0,.35),0 0 24px rgba(69,211,255,.08);}
    .roulette-video-poster{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;background:radial-gradient(circle at 50% 22%,rgba(111,76,255,.25),transparent 28%),radial-gradient(circle at 22% 52%,rgba(64,219,255,.16),transparent 30%),radial-gradient(circle at 82% 42%,rgba(255,66,221,.18),transparent 28%),#030610;}
    .roulette-video-poster-inner{font-family:'Josefin Sans',sans-serif;font-size:clamp(2.1rem,10vw,4rem);font-weight:900;line-height:.9;background:linear-gradient(180deg,#fff,#cbd3df 60%,#fff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;text-shadow:0 0 28px rgba(83,215,255,.18);}
    .roulette-video-poster-inner small{display:block;margin-top:15px;font-family:'Lato',sans-serif;font-size:12px;line-height:1.35;color:#8f9daf;-webkit-text-fill-color:#8f9daf;letter-spacing:.08em;text-transform:uppercase;}
    .roulette-video-stage video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:none;}
    .roulette-video-stage.playing video{display:block;}
    .roulette-video-stage.playing .roulette-video-poster{display:none;}
    #spinBtn.roulette-spin-button{margin-top:16px;padding:19px 16px;border-radius:22px;background:linear-gradient(100deg,#55ddff 0%,#7d9cff 48%,#e678de 100%);color:#040714;font-size:clamp(1.2rem,5vw,1.7rem);font-weight:900;letter-spacing:.04em;box-shadow:inset 0 1px 0 rgba(255,255,255,.65),0 10px 28px rgba(69,198,255,.18);animation:none;}
    .roulette-video-status{min-height:20px;margin:10px 2px 0;text-align:center;color:#8f9daf;font-size:12px;font-weight:700;}
    @media(max-width:560px){.roulette-video-stage{width:100%;max-height:62vh;border-radius:19px}.roulette-video-poster{padding:18px}}
  `;
  document.head.appendChild(style);

  [FREE_VIDEO,BOGO_VIDEO].forEach(src=>{const v=document.createElement('video');v.preload='auto';v.playsInline=true;v.src=src;v.load();});

  window.openSheet=function(id){
    const s=songs.find(x=>x.id===id);if(!s)return;
    document.getElementById('sheetTitle').textContent=s.t;
    document.getElementById('sheetArtist').textContent=s.a||'';
    const nameFieldHtml=`<div class="section-label">🎤 Step 1 — What's your name?</div><input type="text" id="reqName" class="name-input" placeholder="So I can give you a shout-out on the mic!">`;
    const price=prices.general;
    const tierLineHtml=`<span class="badge general"> Song Request</span> <span class="price-tag">$${price}</span>`;
    const spinLockRemaining=getSpinLockRemainingMs();
    let stepTwoHtml;
    if(spinLockRemaining>0){
      const songLabelForPay=`${s.t}${s.a?' - '+s.a:''}`;
      const payUrl=`/pay/?mode=song&amount=${price}&song=${encodeURIComponent(songLabelForPay)}`;
      stepTwoHtml=`<div class="section-label">Step 2 — Pay $${price} (song won't be added until paid)</div><a class="btn btn-text" href="${payUrl}" target="_top">Continue to Payment — $${price}</a>`;
    }else{
      stepTwoHtml=`<div class="roulette-video-card"><div class="section-label" id="step2Label">STEP 2 — SPIN THE ROULETTE FOR A CHANCE TO WIN</div><div class="roulette-video-stage" id="rouletteStage"><div class="roulette-video-poster"><div class="roulette-video-poster-inner">VEGAS<br>ROULETTE<small>Tap Spin to Win</small></div></div><video id="rouletteVideo" playsinline preload="auto" disablepictureinpicture></video></div><button class="btn btn-text roulette-spin-button" id="spinBtn" onclick="spinWheel('${s.id}', ${price})">SPIN TO WIN</button><div class="roulette-video-status" id="rouletteVideoStatus"></div><div id="spinResultArea"></div></div>`;
    }
    document.getElementById('sheetTierLine').innerHTML=tierLineHtml;
    document.getElementById('sheetBody').innerHTML=nameFieldHtml+stepTwoHtml;
    wheelSpinning=false;wheelRotationTotal=0;
    document.getElementById('overlay').classList.add('show');
    document.getElementById('sheet').classList.add('show');
    document.body.style.overflow='hidden';
  };

  window.spinWheel=function(songId,price){
    const spinLockRemaining=getSpinLockRemainingMs();
    if(spinLockRemaining>0){
      const area=document.getElementById('spinResultArea');
      if(area)area.innerHTML='<div class="spin-result">You already used your spin on this device. Try again in '+formatSpinLockRemaining(spinLockRemaining)+' — or <a href="#" onclick="skipSpinToPayment(\''+songId+'\', '+price+'); return false;" style="color:var(--accent);text-decoration:underline;">send this request now for $'+price+'</a>.</div>';
      return;
    }
    if(wheelSpinning)return;
    wheelSpinning=true;
    lockSpinForThisDevice();
    const outcome=Math.random()<0.5?'FREE':'BOGO';
    const video=document.getElementById('rouletteVideo');
    const stage=document.getElementById('rouletteStage');
    const btn=document.getElementById('spinBtn');
    const status=document.getElementById('rouletteVideoStatus');
    if(!video||!stage||!btn){wheelSpinning=false;return;}
    btn.disabled=true;btn.style.opacity='.68';btn.textContent='SPINNING…';
    if(status)status.textContent='Good luck…';
    video.src=outcome==='FREE'?FREE_VIDEO:BOGO_VIDEO;
    video.currentTime=0;
    stage.classList.add('playing');
    let finished=false;
    const complete=()=>{
      if(finished)return;finished=true;
      wheelSpinning=false;
      finishVideoResult(outcome,songId,price);
    };
    video.onended=complete;
    video.onerror=()=>{
      if(finished)return;finished=true;
      wheelSpinning=false;
      localStorage.removeItem('rp_lastSpinAt');
      stage.classList.remove('playing');
      video.removeAttribute('src');video.load();
      btn.disabled=false;btn.style.opacity='1';btn.textContent='SPIN TO WIN';
      if(status)status.textContent='The roulette video did not load. Please try again.';
    };
    const playPromise=video.play();
    if(playPromise&&typeof playPromise.catch==='function')playPromise.catch(()=>{
      wheelSpinning=false;
      localStorage.removeItem('rp_lastSpinAt');
      stage.classList.remove('playing');
      btn.disabled=false;btn.style.opacity='1';btn.textContent='SPIN TO WIN';
      if(status)status.textContent='Tap SPIN TO WIN again to allow video playback.';
    });
  };

  window.finishVideoResult=function(outcome,songId,price){
    const area=document.getElementById('spinResultArea');
    const s=songs.find(x=>x.id===songId);if(!s||!area)return;
    const stage=document.getElementById('rouletteStage');if(stage)stage.style.display='none';
    const spinBtnEl=document.getElementById('spinBtn');if(spinBtnEl)spinBtnEl.style.display='none';
    const status=document.getElementById('rouletteVideoStatus');if(status)status.style.display='none';
    const step2LabelEl=document.getElementById('step2Label');if(step2LabelEl)step2LabelEl.style.display='none';
    if(outcome==='FREE'){
      area.innerHTML=`<div class="spin-result spin-result-free">🎉 You spun FREE! This one's on the house.</div><div class="section-label">Step 3 — Send the request</div><a class="btn btn-text" href="#" target="_top" onclick="prepareSend(this, '${s.id}', 'FREE'); return false;">Send Request</a>`;
    }else{
      area.innerHTML=`<div class="spin-result spin-result-bogo">🎉 You spun BOGO! Pick a second song — it's free.</div><div class="section-label" id="bogoStep3Label">Step 3 — Pick your free second song</div><div id="bogoPickerWrap"><input type="text" id="bogoSearch" class="name-input" placeholder="Search song or artist…" autocomplete="off"><select id="bogoSort" class="bogo-sort-select"><option value="title-asc">Title A → Z</option><option value="title-desc">Title Z → A</option><option value="artist-asc">Artist A → Z</option><option value="artist-desc">Artist Z → A</option></select><div class="chips" id="bogoChips"></div><div class="count-row" id="bogoCountRow"></div><div id="bogoResults" class="bogo-results"></div></div><div id="bogoSelectedWrap" style="display:none"></div><div id="bogoNextSteps"></div>`;
      setupBogoPicker(songId,price);
    }
    area.scrollIntoView({behavior:'smooth',block:'start'});
  };
})();