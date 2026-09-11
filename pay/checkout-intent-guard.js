(function(){
  'use strict';

  let checkoutStarting = false;

  function attach(){
    const button = document.getElementById('continue-button');
    const status = document.getElementById('status');
    const paymentOptions = document.getElementById('payment-options');
    if(!button || !status || !paymentOptions) return;

    const originalText = button.textContent.trim();

    function lockButton(){
      checkoutStarting = true;
      button.dataset.checkoutStarting = '1';
      button.setAttribute('aria-busy', 'true');
      button.style.pointerEvents = 'none';
      button.style.opacity = '.7';
      button.textContent = 'Starting checkout…';
    }

    function unlockButton(){
      checkoutStarting = false;
      delete button.dataset.checkoutStarting;
      button.removeAttribute('aria-busy');
      button.style.pointerEvents = '';
      button.style.opacity = '';
      button.textContent = originalText;
    }

    // Capture phase runs before app.js's normal click handler. The first click
    // is allowed to continue, but the control is immediately made untappable so
    // a fast double-tap cannot create a second Payment Hub intent.
    button.addEventListener('click', function(event){
      if(checkoutStarting){
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      lockButton();
    }, true);

    // If checkout creation fails, app.js writes an error into #status while the
    // payment-options section remains hidden. Restore the button so the guest can
    // correct the problem and try again. Once payment options are visible, keep
    // the Continue button locked because the intent has already been created.
    const observer = new MutationObserver(function(){
      if(!checkoutStarting) return;
      if(!paymentOptions.classList.contains('hidden')) return;
      const text = (status.textContent || '').trim();
      if(text && !/creating secure checkout/i.test(text)) unlockButton();
    });
    observer.observe(status, { childList:true, subtree:true, characterData:true });
    observer.observe(paymentOptions, { attributes:true, attributeFilter:['class'] });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
})();
