(function(){
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

  const observer = new MutationObserver(function(){ muteCurrentRoulette(); });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',muteCurrentRoulette);
  muteCurrentRoulette();

  const originalSpin = window.spinWheel;
  if(typeof originalSpin === 'function'){
    window.spinWheel = function(songId,price){
      muteCurrentRoulette();
      const video = document.getElementById('rouletteVideo');
      enforceMute(video);

      const forced = new URLSearchParams(location.search).get('rouletteTest');
      if(forced === 'FREE' || forced === 'BOGO'){
        const originalRandom = Math.random;
        Math.random = forced === 'FREE' ? function(){ return 0.1; } : function(){ return 0.9; };
        try {
          return originalSpin.call(this,songId,price);
        } finally {
          Math.random = originalRandom;
          setTimeout(muteCurrentRoulette,0);
        }
      }
      const result = originalSpin.call(this,songId,price);
      setTimeout(muteCurrentRoulette,0);
      return result;
    };
  }
})();
