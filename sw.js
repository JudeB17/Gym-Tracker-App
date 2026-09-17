/* ============================================================
   sw.js — minimal service worker for GYM.
   Exists only so the app can post notifications (iOS home-screen web apps
   allow notifications through registration.showNotification only).
   No caching, no fetch interception: the app loads exactly as before.
   ============================================================ */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (all.length) { try { await all[0].focus(); } catch (err) {} return; }
    try { await self.clients.openWindow("./"); } catch (err) {}
  })());
});
