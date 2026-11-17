/* global importScripts, firebase */
self.addEventListener('notificationclick', event => {
  event.stopImmediatePropagation();
  event.notification.close();
  const roomId = event.notification.data?.FCM_MSG?.data?.roomId;
  event.waitUntil(self.clients.openWindow(roomId ? `/home?room=${encodeURIComponent(roomId)}` : '/home'));
});

importScripts('https://www.gstatic.com/firebasejs/13.3.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/13.3.0/firebase-messaging-compat.js');
const config = JSON.parse(new URL(self.location.href).searchParams.get('config'));
firebase.initializeApp(config);
firebase.messaging();
