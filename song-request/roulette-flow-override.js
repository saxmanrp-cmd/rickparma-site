(function(){
  const FREE_VIDEO='./video/roulette-free.mp4';
  const BOGO_VIDEO='./video/roulette-bogo.mp4';
  const LIVE_PAY_BASE='https://rickparma.com/pay/';

  const style=document.createElement('style');
  style.textContent=`
    #sheet.show{position:fixed!important;inset:0!important;z-index:1001!important;width:100%!important;height:100dvh!important;max-height:100dvh!important;display:flex!important;flex-direction:column!important;overflow-y:auto!important;overflow-x:hidden!important;padding:16px 20px calc(22px + env(safe-area-inset-bottom))!important;background:radial-gradient(circle at 16% 7%,rgba(51,207,255,.15),transparent 28%),radial-gradient(circle at 85% 10%,rgba(246,65,226,.12),transparent 30%),linear-gradient(180deg,#02040a 0%,#05070d 52%,#020309 100%)!important;-webkit-overflow-scrolling:touch}
    #sheet.show .sheet-back-btn{position:relative;z-index:2;flex:0 0 auto;border:1px solid rgba(205,224,244,.42);background:linear-gradient(180deg,rgba(28,38,53,.95),rgba(7,12,20,.98));color:#eef4fb;border-radius:999px;padding:10px 15px;font-weight:900;box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 8px 20px rgba(0,0,0,.28)}
    #sheet.show #sheetBody{width:min(100%,700px);margin:0 auto;padding-bottom:24px}
    #sheet.show #sheetTitle,#sheet.show #sheetArtist,#sheet.show #sheetTierLine{width:min(100%,700px);margin-left:auto;margin-right:auto}
    #sheet.show #sheetTitle{margin-top:5px;font-size:clamp(1.65rem,6vw,2.25rem);font-weight:900;letter-spacing:.02em;color:#f4f7fb;text-shadow:0 0 18px rgba(92,207,255,.12)}
    #sheet.show #sheetArtist{margin-top:4px;color:#94a2b6;font-weight:700}
    #sheet.show #sheetTierLine{margin-top:12px;padding-bottom:5px}
    #sheet.show .badge.general{border-color:rgba(102,223,255,.5);background:linear-gradient(180deg,rgba(16,42,57,.96),rgba(6,18,28,.98));color:#86e8ff;border-radius:999px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 0 16px rgba(68,211,255,.09)}
    #sheet.show .price-tag{background:linear-gradient(180deg,#fff,#b7c0ce 65%,#fff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;font-weight:900}

    #sheet.show .section-label{margin:18px 0 8px;padding:0;color:#aab6c8;font-family:'Josefin Sans',sans-serif;font-size:12px;font-weight:900;letter-spacing:.10em;line-height:1.3;text-transform:uppercase}
    #sheet.show #step2Label{color:#7de2ff;font-size:13px;text-shadow:0 0 15px rgba(86,216,255,.18)}
    #sheet.show .name-input,#sheet.show .bogo-sort-select{width:100%;margin-top:0;padding:15px 16px;border:1px solid rgba(177,207,238,.33);border-radius:17px;background:linear-gradient(180deg,rgba(18,26,40,.95),rgba(6,10,17,.98));color:#eef3f8;font-size:16px;font-weight:700;box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 9px 24px rgba(0,0,0,.26);outline:none}
    #sheet.show .name-input:focus,#sheet.show .bogo-sort-select:focus{border-color:rgba(97,221,255,.82);box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 0 0 2px rgba(68,210,255,.08),0 0 24px rgba(65,210,255,.13),0 0 28px rgba(241,77,222,.05)}
    #sheet.show .name-input::placeholder{color:#778394}

    .roulette-video-card{margin-top:14px;padding:16px;border:1px solid rgba(191,216,242,.26);border-radius:25px;background:linear-gradient(180deg,rgba(15,22,35,.84),rgba(5,8,15,.94));box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 18px 48px rgba(0,0,0,.34),0 0 30px rgba(72,207,255,.06)}
    .roulette-video-stage{position:relative;width:min(100%,520px);aspect-ratio:2/3;max-height:68vh;margin:12px auto 0;border-radius:22px;overflow:hidden;border:1px solid rgba(178,210,238,.29);background:#02040a;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 16px 38px rgba(0,0,0,.35),0 0 24px rgba(69,211,255,.08),0 0 28px rgba(239,73,222,.05)}
    .roulette-video-poster{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;background:radial-gradient(circle at 50% 22%,rgba(111,76,255,.25),transparent 28%),radial-gradient(circle at 22% 52%,rgba(64,219,255,.16),transparent 30%),radial-gradient(circle at 82% 42%,rgba(255,66,221,.18),transparent 28%),#030610}
    .roulette-video-poster-inner{font-family:'Josefin Sans',sans-serif;font-size:clamp(2.1rem,10vw,4rem);font-weight:900;line-height:.9;background:linear-gradient(180deg,#fff,#cbd3df 60%,#fff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;text-shadow:0 0 28px rgba(83,215,255,.18)}
    .roulette-video-poster-inner small{display:block;margin-top:15px;font-family:'Lato',sans-serif;font-size:12px;line-height:1.35;color:#8f9daf;-webkit-text-fill-color:#8f9daf;letter-spacing:.08em;text-transform:uppercase}
    .roulette-video-stage video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:none}
    .roulette-video-stage.playing video{display:block}.roulette-video-stage.playing .roulette-video-poster{display:none}
    #spinBtn.roulette-spin-button,#sheet.show .btn.btn-text{width:100%;margin-top:14px;padding:17px 16px;border:1px solid rgba(220,234,249,.52);border-radius:19px;background:linear-gradient(100deg,#54ddff 0%,#718fff 49%,#df76dc 100%);color:#040714;font-size:16px;font-weight:900;letter-spacing:.035em;box-shadow:inset 0 1px 0 rgba(255,255,255,.62),0 10px 26px rgba(65,197,255,.16),0 0 23px rgba(232,89,222,.08);animation:none;text-decoration:none}
    #spinBtn.roulette-spin-button{font-size:clamp(1.2rem,5vw,1.7rem);padding:19px 16px;border-radius:22px}
    .roulette-video-status{min-height:20px;margin:10px 2px 0;text-align:center;color:#8f9daf;font-size:12px;font-weight:700}

    #spinResultArea{margin-top:4px}
    #spinResultArea .spin-result{margin:16px 0 13px;padding:17px 18px;border-radius:18px;background:linear-gradient(180deg,rgba(15,25,39,.95),rgba(5,10,18,.98));color:#edf3f9;font-size:15px;font-weight:900;line-height:1.4;text-align:center;box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 10px 28px rgba(0,0,0,.28)}
    #spinResultArea .spin-result-free{border:1px solid rgba(89,224,255,.52);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 0 22px rgba(77,214,255,.12),0 10px 28px rgba(0,0,0,.28);color:#9beeff}
    #spinResultArea .spin-result-bogo{border:1px solid rgba(244,104,225,.52);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 0 22px rgba(238,79,222,.12),0 10px 28px rgba(0,0,0,.28);color:#ff9ced}

    #bogoPickerWrap{margin-top:8px;padding:15px;border:1px solid rgba(189,214,240,.25);border-radius:21px;background:linear-gradient(180deg,rgba(14,21,34,.88),rgba(5,8,15,.95));box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 14px 34px rgba(0,0,0,.27)}
    #bogoPickerWrap .chips{margin-top:11px;padding:5px 0 3px;gap:8px}
    #bogoPickerWrap .chip{padding:8px 13px;border:1px solid rgba(184,207,233,.25);border-radius:999px;background:linear-gradient(180deg,rgba(20,28,42,.95),rgba(7,11,19,.98));color:#aab6c5;font-size:12px;font-weight:900;box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
    #bogoPickerWrap .chip.active{border-color:rgba(97,221,255,.72);background:linear-gradient(180deg,rgba(19,52,71,.96),rgba(7,20,31,.98));color:#91eaff;box-shadow:0 0 17px rgba(67,211,255,.10)}
    #bogoCountRow{padding:10px 2px 5px;color:#778699;font-size:11px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}
    .bogo-results{max-height:260px;margin-top:4px;border:1px solid rgba(181,206,232,.23);border-radius:16px;overflow-y:auto;background:rgba(3,7,13,.58)}
    .bogo-result-item{padding:13px 14px;border-bottom:1px solid rgba(181,206,232,.12);color:#e9eef5;font-size:14px;font-weight:700;transition:background .15s ease,border-color .15s ease}
    .bogo-result-item:last-child{border-bottom:0}.bogo-result-item:active,.bogo-result-item.selected{background:linear-gradient(90deg,rgba(58,207,255,.13),rgba(235,79,220,.08));border-left:3px solid #61dcff}
    #bogoSelectedWrap{margin-top:10px}
    .bogo-picks{display:flex;flex-direction:column;gap:8px;margin:10px 0}
    .bogo-pick-card{padding:14px 15px;border:1px solid rgba(102,222,255,.38);border-radius:16px;background:linear-gradient(180deg,rgba(16,42,58,.87),rgba(6,17,27,.95));color:#eaf7fb;font-size:14px;font-weight:900;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 0 16px rgba(68,211,255,.06)}
    .bogo-pick-plus{text-align:center;color:#ef83e3;font-size:20px;font-weight:900;text-shadow:0 0 12px rgba(239,83,222,.24)}
    .bogo-change-link{display:block;margin:6px auto 13px;padding:8px 12px;border:0;background:none;color:#7ddfff;font-size:13px;font-weight:800;text-decoration:underline}
    #bogoNextSteps{margin-top:8px;padding-top:2px}

    @media(max-width:560px){#sheet.show{padding:12px 13px calc(18px + env(safe-area-inset-bottom))!important}.roulette-video-card{padding:12px;border-radius:22px}.roulette-video-stage{width:100%;max-height:62vh;border-radius:19px}.roulette-video-poster{padding:18px}#bogoPickerWrap{padding:12px;border-radius:18px}.bogo-results{max-height:240px}}
  `;
  document.head.appendChild(style);

  [FREE_VIDEO,BOGO_VIDEO].forEach(src=>{const v=document.createElement('video');v.preload='auto';v.playsInline=true;v.src=src;v.load();});

  function paymentUrl(songLabel,price){return LIVE_PAY_BASE+'?mode=song&amount='+price+'&song='+encodeURIComponent(songLabel);}

  window.skipSpinToPayment=function(songId,price){const s=songs.find(x=>x.id===songId);if(!s)return;window.top.location.href=paymentUrl(s.t+(s.a?' - '+s.a:''),price);};

  window.renderBogoNextSteps=function(songAId,songBId,price){
    const sA=songs.find(x=>x.id===songAId),sB=songs.find(x=>x.id===songBId);
    const labelA=sA?`${sA.t}${sA.a?' - '+sA.a:''}`:'',labelB=sB?`${sB.t}${sB.a?' - '+sB.a:''}`:'';
    const songLabel=`${labelA} + BOGO: ${labelB}`;
    document.getElementById('bogoNextSteps').innerHTML=`<div class="section-label">Step 4 — Pay $${price} (songs won't be added until paid)</div><a class="btn btn-text" href="${paymentUrl(songLabel,price)}" target="_top">Continue to Payment — $${price}</a>`;
  };

  window.openSheet=function(id){
    const s=songs.find(x=>x.id===id);if(!s)return;
    document.getElementById('sheetTitle').textContent=s.t;
    document.getElementById('sheetArtist').textContent=s.a||'';
    const nameFieldHtml=`<div class="section-label">🎤 Step 1 — What's your name?</div><input type="text" id="reqName" class="name-input" placeholder="So I can give you a shout-out on the mic!">`;
    const price=prices.general;
    const tierLineHtml=`<span class="badge general"> Song Request</span> <span class="price-tag">$${price}</span>`;
    const spinLockRemaining=getSpinLockRemainingMs();let stepTwoHtml;
    if(!spinEnabled||spinLockRemaining>0){
      const songLabelForPay=`${s.t}${s.a?' - '+s.a:''}`;
      stepTwoHtml=`<div class="section-label">Step 2 — Pay $${price} (song won't be added until paid)</div><a class="btn btn-text" href="${paymentUrl(songLabelForPay,price)}" target="_top">Continue to Payment — $${price}</a>`;
    }else{
      stepTwoHtml=`<div class="roulette-video-card"><div class="section-label" id="step2Label">STEP 2 — SPIN THE ROULETTE FOR A CHANCE TO WIN</div><div class="roulette-video-stage" id="rouletteStage"><div class="roulette-video-poster"><div class="roulette-video-poster-inner">VEGAS<br>ROULETTE<small>Tap Spin to Win</small></div></div><video id="rouletteVideo" playsinline preload="auto" disablepictureinpicture></video></div><button class="btn btn-text roulette-spin-button" id="spinBtn" onclick="spinWheel('${s.id}', ${price})">SPIN TO WIN</button><div class="roulette-video-status" id="rouletteVideoStatus"></div><div id="spinResultArea"></div></div>`;
    }
    document.getElementById('sheetTierLine').innerHTML=tierLineHtml;
    document.getElementById('sheetBody').innerHTML=nameFieldHtml+stepTwoHtml;
    wheelSpinning=false;wheelRotationTotal=0;
    document.getElementById('overlay').classList.add('show');document.getElementById('sheet').classList.add('show');document.getElementById('sheet').scrollTop=0;document.body.style.overflow='hidden';
  };

  window.spinWheel=function(songId,price){
    const spinLockRemaining=getSpinLockRemainingMs();
    if(spinLockRemaining>0){const area=document.getElementById('spinResultArea');if(area)area.innerHTML='<div class="spin-result">You already used your spin on this device. Try again in '+formatSpinLockRemaining(spinLockRemaining)+' — or <a href="#" onclick="skipSpinToPayment(\''+songId+'\', '+price+'); return false;" style="color:#7de2ff;text-decoration:underline;">send this request now for $'+price+'</a>.</div>';return;}
    if(wheelSpinning)return;wheelSpinning=true;lockSpinForThisDevice();
    const outcome=Math.random()<(1/7)?'FREE':'BOGO',video=document.getElementById('rouletteVideo'),stage=document.getElementById('rouletteStage'),btn=document.getElementById('spinBtn'),status=document.getElementById('rouletteVideoStatus');
    if(!video||!stage||!btn){wheelSpinning=false;return;}
    btn.disabled=true;btn.style.opacity='.68';btn.textContent='SPINNING…';if(status)status.textContent='Good luck…';video.src=outcome==='FREE'?FREE_VIDEO:BOGO_VIDEO;video.currentTime=0;stage.classList.add('playing');
    let finished=false;const complete=()=>{if(finished)return;finished=true;wheelSpinning=false;finishVideoResult(outcome,songId,price)};video.onended=complete;
    video.onerror=()=>{if(finished)return;finished=true;wheelSpinning=false;localStorage.removeItem('rp_lastSpinAt');stage.classList.remove('playing');video.removeAttribute('src');video.load();btn.disabled=false;btn.style.opacity='1';btn.textContent='SPIN TO WIN';if(status)status.textContent='The roulette video did not load. Please try again.'};
    const playPromise=video.play();if(playPromise&&typeof playPromise.catch==='function')playPromise.catch(()=>{wheelSpinning=false;localStorage.removeItem('rp_lastSpinAt');stage.classList.remove('playing');btn.disabled=false;btn.style.opacity='1';btn.textContent='SPIN TO WIN';if(status)status.textContent='Tap SPIN TO WIN again to allow video playback.'});
  };

  window.finishVideoResult=function(outcome,songId,price){
    const area=document.getElementById('spinResultArea'),s=songs.find(x=>x.id===songId);if(!s||!area)return;
    const stage=document.getElementById('rouletteStage');if(stage)stage.style.display='none';const spinBtnEl=document.getElementById('spinBtn');if(spinBtnEl)spinBtnEl.style.display='none';const status=document.getElementById('rouletteVideoStatus');if(status)status.style.display='none';const step2LabelEl=document.getElementById('step2Label');if(step2LabelEl)step2LabelEl.style.display='none';
    if(outcome==='FREE'){
      area.innerHTML=`<div class="spin-result spin-result-free">🎉 You spun FREE! This one's on the house.</div><div class="section-label">Step 3 — Send the request</div><a class="btn btn-text" href="#" target="_top" onclick="prepareSend(this, '${s.id}', 'FREE'); return false;">Send Request</a>`;
    }else{
      area.innerHTML=`<div class="spin-result spin-result-bogo">🎉 You spun BOGO! Pick a second song — it's free.</div><div class="section-label" id="bogoStep3Label">Step 3 — Pick your free second song</div><div id="bogoPickerWrap"><input type="text" id="bogoSearch" class="name-input" placeholder="Search song or artist…" autocomplete="off"><select id="bogoSort" class="bogo-sort-select"><option value="title-asc">Title A → Z</option><option value="title-desc">Title Z → A</option><option value="artist-asc">Artist A → Z</option><option value="artist-desc">Artist Z → A</option></select><div class="chips" id="bogoChips"></div><div class="count-row" id="bogoCountRow"></div><div id="bogoResults" class="bogo-results"></div></div><div id="bogoSelectedWrap" style="display:none"></div><div id="bogoNextSteps"></div>`;setupBogoPicker(songId,price);
    }
    area.scrollIntoView({behavior:'smooth',block:'start'});
  };
})();
