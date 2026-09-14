importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDd0WQCAl1a9r8wN2fiXriC6aTsN4eYNQA',
  authDomain: 'tri-hybrid-buoy.firebaseapp.com',
  databaseURL: 'https://tri-hybrid-buoy-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'tri-hybrid-buoy',
  storageBucket: 'tri-hybrid-buoy.firebasestorage.app',
  messagingSenderId: '105759750345',
  appId: '1:105759750345:web:6764ecd8270f0010c4f518'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Tri-Hybrid Station Alert';
  const options = {
    body: payload.notification?.body || 'A configured threshold was reached.',
    icon: '/logotrihybrid.png'
  };
  self.registration.showNotification(title, options);
});
