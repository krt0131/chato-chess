(async function () {
  const $ = id => document.getElementById(id);
  const video = $('video'), overlay = $('overlay'), camMsg = $('camMsg');
  const octx = overlay.getContext('2d');
  const scanCanvas = document.createElement('canvas');
  const sctx = scanCanvas.getContext('2d', { willReadFrequently: true });

  let DB;
  try {
    DB = await Chato.loadCharacters();
  } catch (e) {
    camMsg.innerHTML = '데이터를 불러오지 못했어요.<br><b>실행.bat</b>으로 열어 주세요.';
    return;
  }

  let teams = Chato.loadTeams();
  // 저장된 값 중 없는 캐릭터는 정리
  for (const t of ['p1', 'p2']) teams[t] = teams[t].filter(id => DB.byId[id]).slice(0, Chato.MAX_UNITS);

  // ---------- 사운드 ----------
  let actx;
  function tone(freqs, dur = 0.09, type = 'triangle', vol = 0.18) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      let t = actx.currentTime;
      freqs.forEach(f => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type; o.frequency.value = f;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(actx.destination);
        o.start(t); o.stop(t + dur);
        t += dur * 0.85;
      });
    } catch (e) {}
  }
  const sfx = {
    p1: () => tone([523, 784]),
    p2: () => tone([587, 880]),
    err: () => tone([180, 140], 0.12, 'square', 0.08),
    ready: () => tone([523, 659, 784, 1047], 0.11),
  };

  // ---------- 토스트 ----------
  let toastTimer;
  function toast(msg, kind = '') {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast ' + kind; }, 1600);
  }

  // ---------- 등록 ----------
  function register(team, id) {
    const c = DB.byId[id];
    if (!c) { toast('모르는 말이에요', 'warn'); sfx.err(); return; }
    const label = team.toUpperCase();
    if (teams[team].includes(id)) { toast(`${label}: ${c.name}은(는) 이미 등록됐어요`, 'warn'); sfx.err(); return; }
    if (teams[team].length >= Chato.MAX_UNITS) { toast(`${label}는 이미 4개를 다 채웠어요`, 'warn'); sfx.err(); return; }
    teams[team].push(id);
    Chato.saveTeams(teams);
    render(team, id);
    toast(`${label} ${c.icon} ${c.name} 등록!`, team);
    if (teams.p1.length === 4 && teams.p2.length === 4) { sfx.ready(); toast('양 팀 준비 완료! 전투를 시작하세요', 'ready'); }
    else sfx[team]();
  }

  function unregister(team, id) {
    teams[team] = teams[team].filter(x => x !== id);
    Chato.saveTeams(teams);
    render();
  }

  // ---------- 화면 그리기 ----------
  function renderTeam(team, justAdded) {
    const board = $(team + 'Board');
    const placed = Chato.placeTeam(teams[team], DB.byId);
    // P1은 [뒷줄|앞줄], P2는 [앞줄|뒷줄] → 앞줄이 가운데(상대 쪽)를 봄
    const order = team === 'p1' ? ['back', 'front'] : ['front', 'back'];
    board.innerHTML = '';
    order.forEach(row => {
      const colEl = document.createElement('div');
      colEl.className = 'row ' + row;
      colEl.innerHTML = `<div class="row-label">${row === 'front' ? '앞줄' : '뒷줄'}</div>`;
      for (let col = 0; col < Chato.COLS; col++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        const p = placed.find(u => u.row === row && u.col === col);
        if (p) {
          const c = DB.byId[p.id];
          cell.classList.add('filled');
          if (p.id === justAdded) cell.classList.add('pop');
          cell.innerHTML = `<span class="ico">${c.icon}</span>`;
          cell.title = c.name;
        }
        colEl.appendChild(cell);
      }
      board.appendChild(colEl);
    });

    const roster = $(team + 'Roster');
    roster.innerHTML = '';
    for (let i = 0; i < Chato.MAX_UNITS; i++) {
      const id = teams[team][i];
      const li = document.createElement('li');
      if (id) {
        const c = DB.byId[id];
        li.className = 'unit' + (id === justAdded ? ' pop' : '');
        li.innerHTML = `
          <span class="ico">${c.icon}</span>
          <span class="meta"><b>${c.name}</b><small>${c.role} · ${c.skill.name}</small></span>
          <button class="x" title="빼기">×</button>`;
        li.querySelector('.x').onclick = () => unregister(team, id);
      } else {
        li.className = 'unit empty';
        li.innerHTML = `<span class="ico">?</span><span class="meta"><b>빈 자리</b><small>QR을 비춰 주세요</small></span>`;
      }
      roster.appendChild(li);
    }
    $(team + 'Count').textContent = teams[team].length;
    document.querySelector('.team.' + team).classList.toggle('full', teams[team].length === 4);
  }

  function render(team, justAdded) {
    renderTeam('p1', team === 'p1' ? justAdded : null);
    renderTeam('p2', team === 'p2' ? justAdded : null);
    $('startBtn').disabled = !(teams.p1.length === 4 && teams.p2.length === 4);
  }

  // ---------- 카메라 ----------
  let stream, mirrored = true;
  function setMirror(m) {
    mirrored = m;
    $('camBox').classList.toggle('mirror', m);
    try { localStorage.setItem('chato.mirror', m ? '1' : '0'); } catch (e) {}
  }
  try { setMirror(localStorage.getItem('chato.mirror') !== '0'); } catch (e) { setMirror(true); }

  async function startCamera(deviceId) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    camMsg.textContent = '카메라 준비 중…';
    camMsg.hidden = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      camMsg.hidden = true;
      await fillCamList(stream.getVideoTracks()[0].getSettings().deviceId);
    } catch (e) {
      camMsg.innerHTML = '카메라를 켤 수 없어요.<br><small>브라우저의 카메라 권한을 확인해 주세요.</small>';
      console.warn(e);
    }
  }

  async function fillCamList(currentId) {
    const sel = $('camSelect');
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    sel.innerHTML = cams.map((d, i) =>
      `<option value="${d.deviceId}" ${d.deviceId === currentId ? 'selected' : ''}>${d.label || '카메라 ' + (i + 1)}</option>`).join('');
    sel.hidden = cams.length < 2;
  }

  // ---------- QR 스캔 루프 ----------
  const COOLDOWN = 1800; // 같은 QR 재인식 무시 시간(ms)
  const lastSeen = {};
  let lastHit = null;

  function scan() {
    requestAnimationFrame(scan);
    if (video.readyState < 2 || !video.videoWidth) return;
    const w = 640, h = Math.round(640 * video.videoHeight / video.videoWidth);
    if (scanCanvas.width !== w) { scanCanvas.width = w; scanCanvas.height = h; }
    sctx.drawImage(video, 0, 0, w, h);
    const img = sctx.getImageData(0, 0, w, h);
    const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
    const now = performance.now();
    if (code && code.data) {
      const parsed = Chato.parseQR(code.data);
      lastHit = { loc: code.location, w, h, team: parsed ? parsed.team : null, t: now };
      if (parsed && (!lastSeen[code.data] || now - lastSeen[code.data] > COOLDOWN)) {
        register(parsed.team, parsed.id);
      }
      if (parsed) lastSeen[code.data] = now;
    }
    drawOverlay(now);
  }

  function drawOverlay(now) {
    const W = overlay.clientWidth, H = overlay.clientHeight;
    if (overlay.width !== W) { overlay.width = W; overlay.height = H; }
    octx.clearRect(0, 0, W, H);
    if (!lastHit || now - lastHit.t > 250) return;
    // object-fit: cover 보정
    const vw = lastHit.w, vh = lastHit.h;
    const s = Math.max(W / vw, H / vh);
    const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
    const L = lastHit.loc;
    const pts = [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner]
      .map(p => [ox + p.x * s, oy + p.y * s]);
    octx.lineWidth = 6;
    octx.lineJoin = 'round';
    octx.strokeStyle = lastHit.team === 'p1' ? '#ff4d5a' : lastHit.team === 'p2' ? '#4d8dff' : '#aaa';
    octx.beginPath();
    pts.forEach(([x, y], i) => i ? octx.lineTo(x, y) : octx.moveTo(x, y));
    octx.closePath();
    octx.stroke();
  }

  // ---------- 버튼/키보드 ----------
  $('camSelect').onchange = e => startCamera(e.target.value);
  $('mirrorBtn').onclick = () => setMirror(!mirrored);
  $('resetBtn').onclick = () => {
    teams = { p1: [], p2: [] };
    Chato.saveTeams(teams);
    render();
    toast('등록을 모두 초기화했어요');
  };
  $('startBtn').onclick = () => {
    Chato.saveTeams(teams);
    location.href = 'battle.html';
  };
  document.addEventListener('keydown', e => {
    const m = /^Digit([1-8])$/.exec(e.code);
    if (!m) return;
    const c = DB.list[Number(m[1]) - 1];
    if (c) register(e.shiftKey ? 'p2' : 'p1', c.id);
  });

  render();
  startCamera();
  scan();
})();
