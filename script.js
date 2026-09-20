/* ============================================================
   DATA SOURCE TOGGLE
   ------------------------------------------------------------
   true  -> the dashboard generates and displays SAMPLE data
            locally in the browser. No ESP32 / Firebase needed.
   false -> the dashboard reads live data from the Firebase
            Realtime Database (original behavior).

   THIS IS THE ONLY SWITCH YOU NEED TO FLIP LATER.
   ============================================================ */
const USE_SIMULATED_DATA = true;

/* ============================================================
   STATE & PERSISTENCE
   ============================================================ */
const DEFAULTS = {
  account: { username: 'admin', password: 'trihybrid2026' },
  thresholds: { salinityHigh: 38, phLow: 7.6, phHigh: 8.4, humidityHigh: 85, socLow: 30, tempHigh: 31 },
  devices: { solar: true, wind: true, wave: true }
};

function loadJSON(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(e){ return fallback; }
}
function saveJSON(key, val){ localStorage.setItem(key, JSON.stringify(val)); }

let account = loadJSON('th_account', DEFAULTS.account);
let thresholds = { ...DEFAULTS.thresholds, ...loadJSON('th_thresholds', {}) };
let devices = loadJSON('th_devices', DEFAULTS.devices);
let history = loadJSON('th_history', []); // array of {t, humidity, salinity, waterTemp, ph, soc, solarW, windW, waveW}
let session = { role: null }; // 'admin' | 'viewer'

// Pull the latest admin account once at page load (before login), so a
// password/username changed on another device is honored here too.
// Skipped entirely while USE_SIMULATED_DATA is true.
if (!USE_SIMULATED_DATA && window.__db) {
  window.__dbOnValue(window.__dbRef(window.__db, '/account'), (snapshot) => {
    const data = snapshot.val();
    if (data) account = data;
  }, { onlyOnce: true });
}

/* ============================================================
   SIMULATED SENSOR MODEL
   ============================================================ */
let live = {
  humidity: 68, salinity: 34.5, waterTemp: 27.2, ph: 8.0,
  soc: 76, solarW: 420, windW: 180, waveW: 95, loadW: 260
};

function wander(val, min, max, step){
  let v = val + (Math.random()-0.5)*step;
  return Math.max(min, Math.min(max, v));
}

function tick(){
  const hour = new Date().getHours();
  const daylight = hour > 6 && hour < 18 ? Math.sin(((hour-6)/12)*Math.PI) : 0;

  live.humidity = wander(live.humidity, 40, 95, 1.2);
  live.salinity = wander(live.salinity, 30, 40, 0.3);
  live.waterTemp = wander(live.waterTemp, 22, 33, 0.25);
  live.ph = wander(live.ph, 7.2, 8.8, 0.04);

  live.solarW = devices.solar ? Math.max(0, wander(320*daylight+60*daylight, 0, 600, 25)) : 0;
  live.windW = devices.wind ? wander(live.windW, 20, 380, 30) : 0;
  live.waveW =
