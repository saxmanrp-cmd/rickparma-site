(function(){
  const TEST_EXPIRES_AT = Date.parse('2026-08-27T05:55:20Z');
  const params = new URLSearchParams(location.search);
  const forcedOutcome = (params.get('rpTest') || '').toUpperCase();
  const testActive = Date.now() < TEST_EXPIRES_AT && (forcedOutcome === 'FREE' || forcedOutcome === 'BOGO');

  function enforceMute(video){
    if(!video) return;
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.setAttribute('muted','');
    video.setAttribute('playsinline','');
  }

  function muteCurrentRoulette(){
    enforceMute(document.getElementById('rouletteVideo'));
  }

  // Permanent safety: every roulette video element is forced silent.
  const observer = new MutationObserver(muteCurrentRoulette);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',muteCurrentRoulette);
  muteCurrentRoulette();

  if(!testActive) return;

  // For Rick's temporary live-site testing, bypass the device spin lock.
  window.getSpinLockRemainingMs = function(){ return 0; };
  try { localStorage.removeItem('rp_lastSpinAt'); } catch(e) {}

  const originalSpin = window.spinWheel;
  if(typeof originalSpin === 'function'){
    window.spinWheel = function(songId,price){
      try { localStorage.removeItem('rp_lastSpinAt'); } catch(e) {}
      muteCurrentRoulette();
      const originalRandom = Math.random;
      Math.random = forcedOutcome === 'FREE' ? function(){ return 0.1; } : function(){ return 0.9; };
      try {
        const result = originalSpin.call(this,songId,price);
        setTimeout(muteCurrentRoulette,0);
        setTimeout(muteCurrentRoulette,50);
        return result;
      } finally {
        Math.random = originalRandom;
      }
    };
  }
})();
