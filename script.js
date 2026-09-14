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
if (window.__db) {
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
  live.waveW = devices.wave ? wander(live.waveW, 20, 220, 15) : 0;
  live.loadW = wander(live.loadW, 180, 320, 20);

  const genTotal = live.solarW + live.windW + live.waveW;
  const net = genTotal - live.loadW;
  live.soc = Math.max(0, Math.min(100, live.soc + net/4000));

  const entry = {
    t: Date.now(),
    humidity: +live.humidity.toFixed(1),
    salinity: +live.salinity.toFixed(2),
    waterTemp: +live.waterTemp.toFixed(2),
    ph: +live.ph.toFixed(2),
    soc: +live.soc.toFixed(1),
    solarW: Math.round(live.solarW),
    windW: Math.round(live.windW),
    waveW: Math.round(live.waveW),
    loadW: Math.round(live.loadW)
  };
  history.push(entry);
  if(history.length > 2000) history.shift();
  saveJSON('th_history', history);
  checkAlerts(entry);
}

/* seed some history if empty, so charts/logs aren't blank on first run */
function seedHistory(){
  if(history.length) return;
  const now = Date.now();
  for(let i=200;i>=0;i--){
    const t = now - i*5*60*1000;
    const hourOfPoint = new Date(t).getHours();
    const daylight = hourOfPoint>6 && hourOfPoint<18 ? Math.sin(((hourOfPoint-6)/12)*Math.PI) : 0;
    history.push({
      t,
      humidity: +(60+Math.random()*20).toFixed(1),
      salinity: +(32+Math.random()*5).toFixed(2),
      waterTemp: +(24+Math.random()*6).toFixed(2),
      ph: +(7.6+Math.random()*0.8).toFixed(2),
      soc: +(50+Math.random()*40).toFixed(1),
      solarW: Math.round(300*daylight+Math.random()*80),
      windW: Math.round(80+Math.random()*200),
      waveW: Math.round(40+Math.random()*140),
      loadW: Math.round(200+Math.random()*100)
    });
  }
  saveJSON('th_history', history);
}

let alerts = loadJSON('th_alerts', []);
function pushAlert(source, event, level){
  alerts.unshift({ t: Date.now(), source, event, level });
  if(alerts.length > 50) alerts.pop();
  saveJSON('th_alerts', alerts);
}
function checkAlerts(entry){
  if(entry.salinity > thresholds.salinityHigh) pushAlert('Environment', `Salinity elevated at ${entry.salinity} ppt`, 'warn');
  if(entry.ph < thresholds.phLow || entry.ph > thresholds.phHigh) pushAlert('Environment', `pH out of range at ${entry.ph}`, 'bad');
  if(entry.waterTemp > thresholds.tempHigh) pushAlert('Environment', `Water temperature high at ${entry.waterTemp}°C`, 'warn');
  if(entry.humidity > thresholds.humidityHigh) pushAlert('Environment', `Humidity high at ${entry.humidity}%`, 'warn');
  if(entry.soc < thresholds.socLow) pushAlert('Battery', `State of charge low at ${entry.soc}%`, 'bad');
}

/* ============================================================
   LOGIN
   ============================================================ */
const loginScreen = document.getElementById('loginScreen');
const appRoot = document.getElementById('app');
const sidebar = document.querySelector('.sidebar');
const mobileNavToggle = document.getElementById('mobileNavToggle');

mobileNavToggle.addEventListener('click', () => {
  const isOpen = sidebar.classList.toggle('mobile-menu-open');
  mobileNavToggle.setAttribute('aria-expanded', isOpen);
  mobileNavToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
});

document.getElementById('enablePushBtn').addEventListener('click', async () => {
  if(session.role !== 'admin') return;
  const enabled = await window.__enablePushNotifications?.();
  const msg = document.getElementById('adminSaveMsg');
  msg.textContent = enabled ? 'Notifications enabled.' : 'Notifications were not enabled.';
  setTimeout(() => msg.textContent = '', 3000);
});

document.getElementById('loginBtn').addEventListener('click', () => {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const msg = document.getElementById('loginMsg');
  if(!u || !p){ msg.textContent = 'Enter both a username and password.'; return; }
  if(u === account.username && p === account.password){
    session.role = 'admin';
    enterApp();
  } else {
    msg.textContent = 'Incorrect username or password.';
  }
});

document.getElementById('guestBtn').addEventListener('click', () => {
  session.role = 'viewer';
  enterApp();
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  session.role = null;
  appRoot.style.display = 'none';
  loginScreen.style.display = 'flex';
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginMsg').textContent = '';
});

function enterApp(){
  loginScreen.style.display = 'none';
  appRoot.style.display = 'block';
  const isAdmin = session.role === 'admin';
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.page === 'home'));
  document.querySelectorAll('.page').forEach(page => page.classList.toggle('active', page.id === 'page-home'));
  document.getElementById('pageTitle').textContent = pageTitles.home[0];
  document.getElementById('pageSub').textContent = pageTitles.home[1];
  document.getElementById('adminNavGroup').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('whoName').textContent = isAdmin ? account.username : 'Guest viewer';
  document.getElementById('whoRole').textContent = isAdmin ? 'Administrator' : 'Read‑only session';
  populateAdminFields();
  renderAll();
  startClock();
  if(!window.__firebaseStarted){
    window.__firebaseStarted = true;
    startFirebaseSync();
  }
}

/* ============================================================
   FIREBASE SYNC (replaces the old simulated tick() loop)
   Reads live sensor data pushed by the ESP32 instead of
   generating fake values locally.
   ============================================================ */
function startFirebaseSync(){
  const db = window.__db;
  const dbRef = window.__dbRef;
  const onValue = window.__dbOnValue;
  const dbQuery = window.__dbQuery;
  const orderByKey = window.__dbOrderByKey;
  const limitToLast = window.__dbLimitToLast;

  // 1) Live sensor + power readings from the ESP32
  onValue(dbRef(db, '/live'), (snapshot) => {
    const data = snapshot.val();
    if (!data) return;
    live.humidity = data.humidity ?? live.humidity;
    live.salinity = data.salinity ?? live.salinity;
    live.waterTemp = data.waterTemp ?? live.waterTemp;
    live.ph = data.ph ?? live.ph;
    live.soc = data.soc ?? live.soc;
    live.solarW = data.solarW ?? live.solarW;
    live.windW = data.windW ?? live.windW;
    live.waveW = data.waveW ?? live.waveW;
    live.loadW = data.loadW ?? live.loadW;

    checkAlerts({ salinity: live.salinity, ph: live.ph, humidity: live.humidity, waterTemp: live.waterTemp, soc: live.soc });
    renderAll();
  }, (error) => console.error('Firebase /live read failed:', error));

  // 2) Historical readings for charts and Data Logs
  onValue(dbQuery(dbRef(db, '/history'), orderByKey(), limitToLast(500)), (snapshot) => {
    const val = snapshot.val() || {};
    history = Object.values(val);
    if (document.getElementById('page-env').classList.contains('active')) renderEnvChart();
    if (document.getElementById('page-battery').classList.contains('active')) renderPowerChart();
    if (document.getElementById('page-logs').classList.contains('active')) renderLogsTable();
  }, (error) => console.error('Firebase /history read failed:', error));

  // 3) Thresholds — read from Firebase so ESP32-side logic (if any) stays in sync too
  onValue(dbRef(db, '/thresholds'), (snapshot) => {
    const data = snapshot.val();
    if (data) { thresholds = { ...DEFAULTS.thresholds, ...data }; populateAdminFields(); }
  }, (error) => console.error('Firebase /thresholds read failed:', error));

  // 4) Device on/off state
  onValue(dbRef(db, '/devices'), (snapshot) => {
    const data = snapshot.val();
    if (data) {
      devices = data;
      document.querySelectorAll('.toggle').forEach(t => {
        t.classList.toggle('on', devices[t.dataset.device]);
      });
      renderAll();
    }
  }, (error) => console.error('Firebase /devices read failed:', error));

  // 5) Admin account — synced so login works across devices/browsers
  onValue(dbRef(db, '/account'), (snapshot) => {
    const data = snapshot.val();
    if (data) {
      account = data;
      if (session.role === 'admin') {
        document.getElementById('whoName').textContent = account.username;
      }
    }
  }, (error) => console.error('Firebase /account read failed:', error));
}

/* ============================================================
   NAVIGATION
   ============================================================ */
const pageTitles = {
  home: ['Home', 'Live overview of the coastal monitoring station'],
  env: ['Environmental Monitoring', 'Humidity, salinity, water temperature and pH'],
  battery: ['Power & Battery Management', 'Solar, wind and wave generation with battery bank status'],
  camera: ['Surveillance', 'Live feeds from the station perimeter and equipment bay'],
  logs: ['Data Logs', 'Historical sensor and power readings'],
  admin: ['Site Settings', 'Admin‑only configuration for thresholds and devices']
};

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    if(page === 'admin' && session.role !== 'admin') return;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    document.getElementById('pageTitle').textContent = pageTitles[page][0];
    document.getElementById('pageSub').textContent = pageTitles[page][1];
    sidebar.classList.remove('mobile-menu-open');
    mobileNavToggle.setAttribute('aria-expanded', 'false');
    mobileNavToggle.setAttribute('aria-label', 'Open navigation menu');
    if(page === 'env') renderEnvChart();
    if(page === 'battery') renderPowerChart();
    if(page === 'logs') renderLogsTable();
  });
});

function startClock(){
  function upd(){ document.getElementById('clock').textContent = new Date().toLocaleTimeString(); }
  upd();
  setInterval(upd, 1000);
}

/* ============================================================
   RENDER: HOME
   ============================================================ */
function renderAll(){
  renderHome();
  if(document.getElementById('page-env').classList.contains('active')) renderEnvMetrics();
  if(document.getElementById('page-battery').classList.contains('active')) renderBattery();
}

function statusFor(val, low, high){
  if(low !== undefined && val < low) return 'bad';
  if(high !== undefined && val > high) return 'warn';
  return 'ok';
}

function renderHome(){
  const m = document.getElementById('homeMetrics');
  const genTotal = Math.round(live.solarW + live.windW + live.waveW);
  m.innerHTML = `
    ${metricCard('Water temperature', live.waterTemp.toFixed(1), '°C', statusFor(live.waterTemp, undefined, thresholds.tempHigh))}
    ${metricCard('pH level', live.ph.toFixed(2), '', statusFor(live.ph, thresholds.phLow, thresholds.phHigh))}
    ${metricCard('Battery charge', live.soc.toFixed(0), '%', statusFor(live.soc, thresholds.socLow, undefined))}
    ${metricCard('Total generation', genTotal, 'W', 'ok')}
  `;
  const p = document.getElementById('homePower');
  p.innerHTML = `
    ${sourceMini('Solar', live.solarW, '#f0a93a', devices.solar)}
    ${sourceMini('Wind', live.windW, '#7fb8e8', devices.wind)}
    ${sourceMini('Wave', live.waveW, '#3e7cb1', devices.wave)}
  `;
  const tbody = document.querySelector('#homeAlerts tbody');
  if(alerts.length === 0){
    tbody.innerHTML = `<tr><td colspan="4" class="empty">No alerts recorded yet.</td></tr>`;
  } else {
    tbody.innerHTML = alerts.slice(0,6).map(a => `
      <tr><td>${new Date(a.t).toLocaleTimeString()}</td><td>${a.source}</td><td>${a.event}</td>
      <td><span class="badge ${a.level}">${a.level === 'bad' ? 'Critical' : 'Warning'}</span></td></tr>
    `).join('');
  }
}

function metricCard(label, value, unit, status){
  const subMap = { ok: ['metric-sub up','Within normal range'], warn: ['metric-sub down','Approaching limit'], bad: ['metric-sub down','Outside safe range'] };
  const [cls, txt] = subMap[status];
  return `<div class="card"><h3>${label}</h3><div class="metric">${value}<span class="unit">${unit}</span></div><div class="${cls}">${txt}</div></div>`;
}
function sourceMini(name, watts, color, on){
  return `<div class="card"><h3>${name}</h3><div class="metric" style="color:${on?'inherit':'var(--foam-dim)'};">${on?Math.round(watts):'—'}<span class="unit">W</span></div>
  <div class="bar-track"><div class="bar-fill" style="width:${on?Math.min(100,watts/6):0}%;background:${color};"></div></div></div>`;
}

/* ============================================================
   RENDER: ENVIRONMENT
   ============================================================ */
function renderEnvMetrics(){
  const el = document.getElementById('envMetrics');
  el.innerHTML = `
    ${metricCard('Humidity', live.humidity.toFixed(1), '%', statusFor(live.humidity, undefined, thresholds.humidityHigh))}
    ${metricCard('Salinity', live.salinity.toFixed(2), 'ppt', statusFor(live.salinity, undefined, thresholds.salinityHigh))}
    ${metricCard('Water temperature', live.waterTemp.toFixed(2), '°C', statusFor(live.waterTemp, undefined, thresholds.tempHigh))}
    ${metricCard('pH level', live.ph.toFixed(2), '', statusFor(live.ph, thresholds.phLow, thresholds.phHigh))}
  `;
}

let envChartObj = null;
function renderEnvChart(){
  renderEnvMetrics();
  const key = document.getElementById('envChartSelect').value;
  const slice = history.slice(-96);
  const labels = slice.map(h => new Date(h.t).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}));
  const data = slice.map(h => h[key]);
  const ctx = document.getElementById('envChart');
  if(envChartObj) envChartObj.destroy();
  envChartObj = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: '#2bd4b8', backgroundColor: 'rgba(43,212,184,0.12)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#a9c2c4', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#a9c2c4' }, grid: { color: 'rgba(255,255,255,0.06)' } }
      }
    }
  });
}
document.getElementById('envChartSelect').addEventListener('change', renderEnvChart);

/* ============================================================
   RENDER: BATTERY / POWER
   ============================================================ */
function renderBattery(){
  document.getElementById('socValue').innerHTML = `${live.soc.toFixed(0)}<span class="unit">%</span>`;
  document.getElementById('socBar').style.width = live.soc + '%';
  document.getElementById('socBar').style.background = live.soc < thresholds.socLow ? 'var(--danger)' : 'var(--teal)';
  document.getElementById('socSub').textContent = live.soc < thresholds.socLow ? 'Below configured minimum — consider load shedding' : 'Battery bank healthy';

  const net = Math.round(live.solarW + live.windW + live.waveW - live.loadW);
  document.getElementById('netPower').innerHTML = `${net>0?'+':''}${net}<span class="unit">W</span>`;
  document.getElementById('netPowerSub').textContent = net >= 0 ? 'Charging — generation exceeds load' : 'Discharging — load exceeds generation';

  const cards = document.getElementById('sourceCards');
  cards.innerHTML = `
    ${sourceCard('solar','Solar array','#f0a93a', live.solarW, devices.solar, '☀')}
    ${sourceCard('wind','Wind turbine','#7fb8e8', live.windW, devices.wind, '🌬')}
    ${sourceCard('wave','Wave converter','#3e7cb1', live.waveW, devices.wave, '🌊')}
  `;
}
function sourceCard(id,name,color,watts,on,glyph){
  return `<div class="card source-card source-${id}">
    <div class="icon-wrap" style="background:${color}22;">
      <span style="font-size:16px;">${glyph}</span>
    </div>
    <h3>${name}</h3>
    <div class="metric" style="color:${on?'inherit':'var(--foam-dim)'};">${on?Math.round(watts):'0'}<span class="unit">W</span></div>
    <div class="metric-sub">${on ? 'Online' : 'Offline (disabled in Site Settings)'}</div>
  </div>`;
}

let powerChartObj = null;
function renderPowerChart(){
  const slice = history.slice(-60);
  const labels = slice.map(h => new Date(h.t).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}));
  const ctx = document.getElementById('powerChart');
  if(powerChartObj) powerChartObj.destroy();
  powerChartObj = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Solar', data: slice.map(h=>h.solarW), borderColor:'#f0a93a', backgroundColor:'transparent', tension:0.35, pointRadius:0, borderWidth:2 },
        { label: 'Wind', data: slice.map(h=>h.windW), borderColor:'#7fb8e8', backgroundColor:'transparent', tension:0.35, pointRadius:0, borderWidth:2 },
        { label: 'Wave', data: slice.map(h=>h.waveW), borderColor:'#3e7cb1', backgroundColor:'transparent', tension:0.35, pointRadius:0, borderWidth:2 }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ color:'#e7f2f1' } } },
      scales:{
        x:{ ticks:{ color:'#a9c2c4', maxTicksLimit:8 }, grid:{ color:'rgba(255,255,255,0.04)' } },
        y:{ ticks:{ color:'#a9c2c4' }, grid:{ color:'rgba(255,255,255,0.06)' } }
      }
    }
  });
}

/* ============================================================
   CAMERA SURVEILLANCE (simulated feeds)
   ============================================================ */
const camNames = ['Perimeter — North Dock','Perimeter — South Dock','Equipment Bay','Turbine Mast'];
function buildCameraGrid(){
  const grid = document.getElementById('camGrid');
  grid.innerHTML = camNames.map((name, i) => `
    <div>
      <div class="cam-feed">
        <canvas id="camCanvas${i}"></canvas>
        <div class="cam-overlay"><span>CAM ${i+1} · ${name}</span><span class="rec"><span class="dot"></span>LIVE</span></div>
      </div>
      <div class="cam-caption">
        <span id="camTime${i}">--:--:--</span>
        <div class="cam-actions">
          <div class="icon-btn" title="Snapshot" onclick="snapCam(${i})">📷</div>
          <div class="icon-btn" title="Fullscreen" onclick="document.getElementById('camCanvas${i}').requestFullscreen && document.getElementById('camCanvas${i}').requestFullscreen()">⛶</div>
        </div>
      </div>
    </div>
  `).join('');
  camNames.forEach((_, i) => initCamCanvas(i));
}
function initCamCanvas(i){
  const canvas = document.getElementById('camCanvas' + i);
  const ctx = canvas.getContext('2d');
  function resize(){ canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; }
  resize();
  window.addEventListener('resize', resize);
  let hue = [190, 170, 205, 160][i];
  function draw(){
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = `hsl(${hue},35%,${8+Math.sin(Date.now()/4000+i)*2}%)`;
    ctx.fillRect(0,0,w,h);
    // horizon line
    ctx.strokeStyle = `hsla(${hue},40%,45%,0.5)`;
    ctx.beginPath(); ctx.moveTo(0, h*0.55); ctx.lineTo(w, h*0.55); ctx.stroke();
    // simple noise scanlines for a "camera feed" feel
    for(let y=0;y<h;y+=3){
      ctx.fillStyle = `rgba(255,255,255,${Math.random()*0.015})`;
      ctx.fillRect(0,y,w,1);
    }
    // silhouettes representing equipment
    ctx.fillStyle = `hsla(${hue},30%,20%,0.9)`;
    ctx.fillRect(w*0.1, h*0.55, w*0.05, h*0.3);
    ctx.fillRect(w*0.75, h*0.5, w*0.06, h*0.35);
    document.getElementById('camTime'+i).textContent = new Date().toLocaleTimeString();
    requestAnimationFrame(draw);
  }
  draw();
}
function snapCam(i){
  const canvas = document.getElementById('camCanvas'+i);
  const link = document.createElement('a');
  link.download = `cam${i+1}_${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

/* ============================================================
   DATA LOGS
   ============================================================ */
let logsPage = 0;
const LOGS_PER_PAGE = 12;
function flattenLogs(){
  const rows = [];
  history.forEach(h => {
    rows.push({ t:h.t, param:'humidity', label:'Humidity', value:h.humidity+' %', raw:h.humidity, status: h.humidity>thresholds.humidityHigh?'warn':'ok' });
    rows.push({ t:h.t, param:'salinity', label:'Salinity', value:h.salinity+' ppt', raw:h.salinity, status: h.salinity>thresholds.salinityHigh?'warn':'ok' });
    rows.push({ t:h.t, param:'waterTemp', label:'Water Temperature', value:h.waterTemp+' °C', raw:h.waterTemp, status: h.waterTemp>thresholds.tempHigh?'warn':'ok' });
    rows.push({ t:h.t, param:'ph', label:'pH', value:h.ph, raw:h.ph, status: (h.ph<thresholds.phLow||h.ph>thresholds.phHigh)?'bad':'ok' });
    rows.push({ t:h.t, param:'soc', label:'Battery SOC', value:h.soc+' %', raw:h.soc, status: h.soc<thresholds.socLow?'bad':'ok' });
  });
  return rows.sort((a,b)=>b.t-a.t);
}
function renderLogsTable(){
  const typeFilter = document.getElementById('logFilterType').value;
  const dateFilter = document.getElementById('logFilterDate').value;
  const search = document.getElementById('logSearch').value.trim().toLowerCase();
  let rows = flattenLogs();
  if(typeFilter !== 'all') rows = rows.filter(r => r.param === typeFilter);
  if(dateFilter) rows = rows.filter(r => new Date(r.t).toISOString().slice(0,10) === dateFilter);
  if(search) rows = rows.filter(r => r.label.toLowerCase().includes(search));

  const totalPages = Math.max(1, Math.ceil(rows.length / LOGS_PER_PAGE));
  logsPage = Math.min(logsPage, totalPages-1);
  const pageRows = rows.slice(logsPage*LOGS_PER_PAGE, logsPage*LOGS_PER_PAGE + LOGS_PER_PAGE);

  const tbody = document.querySelector('#logsTable tbody');
  tbody.innerHTML = pageRows.length ? pageRows.map(r => `
    <tr><td>${new Date(r.t).toLocaleString()}</td><td>${r.label}</td><td>${r.value}</td>
    <td><span class="badge ${r.status}">${r.status==='ok'?'Normal':r.status==='warn'?'Warning':'Critical'}</span></td></tr>
  `).join('') : `<tr><td colspan="4" class="empty">No log entries match these filters.</td></tr>`;
  document.getElementById('logsPageInfo').textContent = `Page ${logsPage+1} of ${totalPages}`;
  window.__filteredLogsForExport = rows;
}
['change','input'].forEach(evt => {
  document.getElementById('logFilterType').addEventListener(evt, () => { logsPage=0; renderLogsTable(); });
  document.getElementById('logFilterDate').addEventListener(evt, () => { logsPage=0; renderLogsTable(); });
  document.getElementById('logSearch').addEventListener(evt, () => { logsPage=0; renderLogsTable(); });
});
document.getElementById('logsPrev').addEventListener('click', () => { if(logsPage>0){ logsPage--; renderLogsTable(); } });
document.getElementById('logsNext').addEventListener('click', () => { logsPage++; renderLogsTable(); });
document.getElementById('clearFilterBtn').addEventListener('click', () => {
  document.getElementById('logFilterType').value = 'all';
  document.getElementById('logFilterDate').value = '';
  document.getElementById('logSearch').value = '';
  logsPage = 0; renderLogsTable();
});
document.getElementById('exportCsvBtn').addEventListener('click', () => {
  const rows = window.__filteredLogsForExport || flattenLogs();
  const csv = ['Timestamp,Parameter,Value,Status', ...rows.map(r => `${new Date(r.t).toISOString()},${r.label},${r.value},${r.status}`)].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `tri-hybrid-logs-${Date.now()}.csv`;
  link.click();
});

/* ============================================================
   ADMIN SETTINGS
   ============================================================ */
function populateAdminFields(){
  document.getElementById('thSalinity').value = thresholds.salinityHigh;
  document.getElementById('thPhLow').value = thresholds.phLow;
  document.getElementById('thPhHigh').value = thresholds.phHigh;
  document.getElementById('thHumidity').value = thresholds.humidityHigh;
  document.getElementById('thSoc').value = thresholds.socLow;
  document.getElementById('thTemp').value = thresholds.tempHigh;
  document.querySelectorAll('.toggle').forEach(t => {
    const dev = t.dataset.device;
    t.classList.toggle('on', devices[dev]);
  });
}
document.querySelectorAll('.toggle').forEach(t => {
  t.addEventListener('click', () => {
    if(session.role !== 'admin') return;
    const dev = t.dataset.device;
    devices[dev] = !devices[dev];
    t.classList.toggle('on', devices[dev]);
    saveJSON('th_devices', devices);
    if (window.__db) window.__dbSet(window.__dbRef(window.__db, `/devices/${dev}`), devices[dev]);
  });
});
document.getElementById('saveThresholdsBtn').addEventListener('click', () => {
  thresholds.salinityHigh = parseFloat(document.getElementById('thSalinity').value);
  thresholds.phLow = parseFloat(document.getElementById('thPhLow').value);
  thresholds.phHigh = parseFloat(document.getElementById('thPhHigh').value);
  thresholds.humidityHigh = parseFloat(document.getElementById('thHumidity').value);
  thresholds.socLow = parseFloat(document.getElementById('thSoc').value);
  thresholds.tempHigh = parseFloat(document.getElementById('thTemp').value);
  saveJSON('th_thresholds', thresholds);
  if (window.__db) window.__dbSet(window.__dbRef(window.__db, '/thresholds'), thresholds);
  const msg = document.getElementById('adminSaveMsg');
  msg.textContent = 'Settings saved.';
  setTimeout(() => msg.textContent = '', 2500);
});
document.getElementById('saveAccountBtn').addEventListener('click', () => {
  const u = document.getElementById('newUsername').value.trim();
  const p = document.getElementById('newPassword').value;
  if(u) account.username = u;
  if(p) account.password = p;
  saveJSON('th_account', account);
  if (window.__db) window.__dbSet(window.__dbRef(window.__db, '/account'), account);
  document.getElementById('whoName').textContent = account.username;
  document.getElementById('newUsername').value = '';
  document.getElementById('newPassword').value = '';
  const msg = document.getElementById('adminSaveMsg');
  msg.textContent = 'Account updated.';
  setTimeout(() => msg.textContent = '', 2500);
});

/* ============================================================
   INIT
   ============================================================ */
buildCameraGrid();