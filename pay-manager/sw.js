const CACHE='pay-hub-manager-v5';
const SHELL=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png'];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  const u=new URL(req.url);
  if(u.pathname.startsWith('/api/')) return;
  if(req.method!=='GET' || u.origin!==self.location.origin) return;

  const isAppAsset=req.mode==='navigate' || /\.(?:html|js|css|webmanifest)$/.test(u.pathname);
  if(isAppAsset){
    event.respondWith(
      fetch(req,{cache:'no-store'})
        .then(r=>{
          const copy=r.clone();
          caches.open(CACHE).then(c=>c.put(req,copy));
          return r;
        })
        .catch(()=>caches.match(req).then(cached=>cached||caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>cached||fetch(req).then(r=>{
      const copy=r.clone();
      caches.open(CACHE).then(c=>c.put(req,copy));
      return r;
    }))
  );
});
