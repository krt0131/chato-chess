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
  // 좌우반전은 카메라마다 따로 기억 (얼굴 쪽 웹캠은 반전, 위에서 내려다보는 실물화상기는 반전 안 함 등)
  let mirrorKey = 'chato.mirror';
  function setMirror(m, save = true) {
    mirrored = m;
    $('camBox').classList.toggle('mirror', m);
    if (save) { try { localStorage.setItem(mirrorKey, m ? '1' : '0'); localStorage.setItem('chato.mirror', m ? '1' : '0'); } catch (e) {} }
  }
  function applyMirrorFor(label) {
    mirrorKey = 'chato.mirror:' + (label || 'default');
    let v = null;
    try { v = localStorage.getItem(mirrorKey); } catch (e) {}
    setMirror(v === null ? true : v === '1', false); // 이 카메라에 저장된 값, 처음 쓰는 카메라는 기본(반전 켬)
  }
  try { setMirror(localStorage.getItem('chato.mirror') !== '0', false); } catch (e) { setMirror(true, false); }

  // 카메라 교체 대비:
  //  - 마지막으로 고른 카메라를 기억 (deviceId + 이름. 포트를 바꿔 꽂으면 id가 바뀔 수 있어 이름으로도 찾음)
  //  - 카메라를 꽂거나 뽑으면 자동 감지 (devicechange)
  //  - 쓰던 카메라가 빠지면 다른 카메라로 전환, 저장된 카메라가 다시 꽂히면 자동 복귀
  const CAM_KEY = 'chato.cam';
  let currentCamId = null;
  let knownCamCount = 0;
  let busy = Promise.resolve();

  function loadPref() { try { return JSON.parse(localStorage.getItem(CAM_KEY)) || null; } catch (e) { return null; } }
  function savePref(id, label) { try { localStorage.setItem(CAM_KEY, JSON.stringify({ id, label })); } catch (e) {} }
  async function listCams() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); }
    catch (e) { return []; }
  }
  function isPref(cam, pref) { return !!pref && (cam.deviceId === pref.id || (!!pref.label && cam.label === pref.label)); }

  function camError(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return '카메라 권한이 막혀 있어요.<br><small>주소창 왼쪽 자물쇠 → 카메라 → 허용 후 새로고침해 주세요.</small>';
    if (n === 'NotReadableError' || n === 'TrackStartError') return '카메라를 다른 프로그램이 쓰고 있어요.<br><small>줌·카메라 앱 등을 끄고 다시 골라 주세요.</small>';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return '연결된 카메라가 없어요.<br><small>카메라를 꽂으면 자동으로 켜져요.</small>';
    return '카메라를 켤 수 없어요.<br><small>카메라 연결과 브라우저 권한을 확인해 주세요.</small>';
  }

  // 실제로 카메라 켜기 (실패하면 예외)
  async function openCam(deviceId) {
    if (stream) { stream.getTracks().forEach(t => { t.onended = null; t.stop(); }); stream = null; }
    currentCamId = null;
    camMsg.textContent = '카메라 준비 중…';
    camMsg.hidden = false;
    const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const s = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId }, ...size } : size,
      audio: false,
    });
    stream = s;
    const track = s.getVideoTracks()[0];
    currentCamId = track.getSettings().deviceId || deviceId || null;
    track.onended = onCamLost; // 케이블이 빠지면 호출됨
    applyMirrorFor(track.label);
    video.srcObject = s;
    await video.play().catch(() => {});
    camMsg.hidden = true;
    return track;
  }

  // 순서대로 실행 (꽂기/뽑기 이벤트가 겹쳐도 꼬이지 않게)
  function queueCam(fn) { busy = busy.then(fn).catch(e => console.warn(e)); return busy; }

  // 처음 켤 때: 저장된 카메라 → 이름으로 찾기 → 기본 카메라
  function initCamera() {
    return queueCam(async () => {
      const pref = loadPref();
      if (pref && pref.id) {
        try { await openCam(pref.id); await fillCamList(); return; } catch (e) { /* 아래에서 이름으로 다시 찾음 */ }
      }
      try {
        const track = await openCam(null);
        if (pref) {
          const match = (await listCams()).find(c => isPref(c, pref));
          if (match && match.deviceId !== currentCamId) {
            await openCam(match.deviceId);
            savePref(match.deviceId, match.label); // id가 바뀌었으면 갱신
          } else if (!match) {
            toast(`저장된 카메라(${pref.label || '이전 카메라'})가 없어서 다른 카메라를 쓰고 있어요`);
          }
        } else {
          savePref(currentCamId, track.label);
        }
      } catch (e) {
        camMsg.innerHTML = camError(e);
        camMsg.hidden = false;
      }
      await fillCamList();
    });
  }

  // 사용자가 목록에서 고름 → 켜고 기억
  function chooseCamera(deviceId) {
    return queueCam(async () => {
      try {
        const track = await openCam(deviceId);
        savePref(currentCamId, track.label);
        toast(`카메라: ${track.label || '선택한 카메라'}`);
      } catch (e) {
        camMsg.innerHTML = camError(e);
        camMsg.hidden = false;
      }
      await fillCamList();
    });
  }

  // 쓰던 카메라가 빠졌을 때
  function onCamLost() {
    camMsg.innerHTML = '카메라 연결이 끊겼어요.<br><small>다른 카메라를 찾는 중…</small>';
    camMsg.hidden = false;
    currentCamId = null;
    setTimeout(() => queueCam(async () => {
      if (stream && stream.active && currentCamId) return; // 그 사이 다른 카메라로 이미 전환됨
      const cams = await listCams();
      if (!cams.length) { camMsg.innerHTML = camError({ name: 'NotFoundError' }); await fillCamList(); return; }
      try { const t = await openCam(cams[0].deviceId); toast(`카메라가 빠져서 ${t.label || '다른 카메라'}로 바꿨어요`); }
      catch (e) { camMsg.innerHTML = camError(e); camMsg.hidden = false; }
      await fillCamList();
    }), 600);
  }

  // 카메라를 꽂거나 뽑았을 때
  if (navigator.mediaDevices && 'ondevicechange' in navigator.mediaDevices) {
    let t = null;
    navigator.mediaDevices.addEventListener('devicechange', () => {
      clearTimeout(t);
      t = setTimeout(() => queueCam(async () => {
        const cams = await listCams();
        const pref = loadPref();
        const prefCam = cams.find(c => isPref(c, pref));
        const curAlive = currentCamId && cams.some(c => c.deviceId === currentCamId);
        if (prefCam && prefCam.deviceId !== currentCamId) {
          // 저장된 카메라가 (다시) 꽂힘 → 그걸로 복귀
          try { const tr = await openCam(prefCam.deviceId); savePref(currentCamId, tr.label); toast(`저장된 카메라(${tr.label || ''})로 바꿨어요`); }
          catch (e) { console.warn(e); }
        } else if (!curAlive && cams.length) {
          // 카메라가 없던 상태에서 새로 꽂힘
          try { const tr = await openCam(cams[0].deviceId); toast(`새 카메라 연결: ${tr.label || '카메라'}`); }
          catch (e) { camMsg.innerHTML = camError(e); camMsg.hidden = false; }
        } else if (cams.length > knownCamCount) {
          // 지금 카메라는 그대로 두고, 새로 꽂힌 카메라는 목록에만 추가
          toast('새 카메라가 연결됐어요. 위쪽 📷 메뉴에서 고를 수 있어요');
        }
        await fillCamList();
      }), 700);
    });
  }

  async function fillCamList() {
    const sel = $('camSelect');
    const cams = await listCams();
    knownCamCount = cams.length;
    const pref = loadPref();
    if (!cams.length) {
      sel.innerHTML = '<option value="">📷 카메라 없음</option>';
    } else {
      sel.innerHTML = cams.map((d, i) => {
        const name = d.label || '카메라 ' + (i + 1);
        const star = isPref(d, pref) ? ' ★' : '';
        return `<option value="${d.deviceId}" ${d.deviceId === currentCamId ? 'selected' : ''}>📷 ${name}${star}</option>`;
      }).join('');
    }
    sel.title = '카메라 선택 (★ = 기억된 카메라). 새 카메라를 꽂으면 자동으로 목록에 추가돼요';
    sel.hidden = false;
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
  $('camSelect').onchange = e => { if (e.target.value) chooseCamera(e.target.value); };
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
  initCamera();
  scan();
})();
