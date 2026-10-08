// Service worker: makes the dashboard installable and shows push notifications.
// No fetch handler on purpose — the app always loads fresh from the network.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));

self.addEventListener('push',e=>{
  let d={};
  try{d=e.data?e.data.json():{}}catch{d={body:e.data&&e.data.text()}}
  e.waitUntil(self.registration.showNotification(d.title||'דשבורד',{
    body:d.body||'',
    icon:'icon-192.png',
    badge:'icon-192.png',
    tag:d.tag||'tasks',
    dir:'rtl',
    lang:'he',
    data:{page:d.page||'tasks'},
  }));
});

self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const page=e.notification.data?.page||'tasks';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    const open=list.find(c=>c.url.startsWith(self.registration.scope));
    if(open){open.postMessage({page});return open.focus();}
    return self.clients.openWindow('./?page='+page);
  }));
});
