(async function () {
  const $ = id => document.getElementById(id);
  const DB = await Chato.loadCharacters();
  const sfx = Chato.sfx;

  // ---------- 팀 불러오기 (없으면 무작위 시연 팀) ----------
  let teams = Chato.loadTeams();
  if (teams.p1.length !== 4 || teams.p2.length !== 4) {
    const pick = () => DB.list.map(c => c.id).sort(() => Math.random() - 0.5).slice(0, 4);
    teams = { p1: pick(), p2: pick() };
    $('demoNote').hidden = false;
  }

  // ---------- 상수 ----------
  const BW = 8, BH = 4;             // 판 크기 (x: 진영 방향, y: 4칸)
  const TILE_SPEED = 1.5;           // moveSpeed 1.0 = 초당 1.5칸
  const MELEE_RANGE = 1.05;
  const TIME_LIMIT = 60;
  const COUNTDOWN = 3.2;
  const COLOR = { p1: '#e5404d', p2: '#3d7dff' };
  const PED = {                     // 말 받침 색 (옆면, 윗면 안쪽, 윗면 바깥)
    p1: ['#6e1820', '#ff8a93', '#d63340'],
    p2: ['#172f6b', '#8db8ff', '#2f6be0'],
  };
  const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  const UI_FONT = '"Pretendard","Malgun Gothic",sans-serif';
  const ATTACK_SFX = { archer: 'shoot', mage: 'magic', priest: 'holy', warlock: 'shadow' };

  // ---------- 상태 ----------
  let S, uidSeq = 0;

  function makeUnit(team, p, idx) {
    const c = DB.byId[p.id];
    const x = team === 'p1' ? (p.row === 'front' ? 2.5 : 1.5) : (p.row === 'front' ? 5.5 : 6.5);
    return {
      uid: ++uidSeq, team, c, row: p.row, x, y: p.col + 0.5,
      hp: c.hp, maxHp: c.hp, mana: 0, shield: 0, shieldT: 0,
      atkCd: 0.2 + Math.random() * 0.5, target: null, retargetT: 0,
      stun: 0, buffs: [], alive: true, deadT: 0, dmgDealt: 0, healDone: 0,
      lunge: 0, lungeDir: [0, 0], hit: 0, cast: 0, jump: null, bob: Math.random() * 6,
      dropDelay: 0.15 + idx * 0.13, landed: false,
    };
  }

  function newBattle() {
    uidSeq = 0;
    const units = [];
    // P1, P2 번갈아 떨어지도록 순서 섞기
    const placed = { p1: Chato.placeTeam(teams.p1, DB.byId), p2: Chato.placeTeam(teams.p2, DB.byId) };
    for (let i = 0; i < 4; i++) {
      for (const team of ['p1', 'p2']) if (placed[team][i]) units.push(makeUnit(team, placed[team][i], units.length));
    }
    S = {
      units, projs: [], fx: [], texts: [], labels: [], parts: [],
      time: 0, phase: 'countdown', countdown: COUNTDOWN, lastCount: 4, winner: null,
      shake: 0, slowmo: 0, flash: 0, goT: 0,
    };
    $('result').hidden = true;
    buildHud();
  }

  // ---------- 유틸 ----------
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const enemiesOf = u => S.units.filter(o => o.alive && o.team !== u.team);
  const alliesOf = u => S.units.filter(o => o.alive && o.team === u.team);
  const rangeOf = u => (u.c.range <= 1 ? MELEE_RANGE : u.c.range);
  const clampPos = u => {
    u.x = Math.max(0.3, Math.min(BW - 0.3, u.x));
    u.y = Math.max(0.3, Math.min(BH - 0.3, u.y));
  };
  const mult = (u, key) => u.buffs.reduce((m, b) => m * (b[key] ?? 1), 1);
  const lifesteal = u => u.buffs.reduce((m, b) => m + (b.ls || 0), 0);
  const rand = (a, b) => a + Math.random() * (b - a);
  function nearest(u, list) {
    let best = null, bd = Infinity;
    for (const o of list) { const d = dist(u, o); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  function addBuff(u, b) {
    u.buffs = u.buffs.filter(x => x.type !== b.type);
    u.buffs.push(b);
  }
  function shake(n) { S.shake = Math.max(S.shake, n); }

  // 파티클: x,y는 판 좌표, z는 높이(타일 단위)
  function spark(x, y, z, n, colors, power = 1, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(0.6, 2.2) * power;
      S.parts.push({
        x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(0.5, 2.5) * power,
        g: opts.g ?? 6, life: rand(0.35, 0.7) * (opts.life || 1), t: 0,
        size: rand(2, 4.5) * (opts.size || 1), color: colors[i % colors.length],
      });
    }
  }

  // ---------- 전투 처리 ----------
  function floatText(u, text, color, size = 1) {
    S.texts.push({ x: u.x, y: u.y, text, color, size, t: 0, life: 0.9, jitter: rand(-0.18, 0.18) });
  }
  function skillLabel(u, text) {
    S.labels = S.labels.filter(l => l.u !== u);
    S.labels.push({ u, text, t: 0, life: 1.2 });
  }

  function dealDamage(src, tgt, amount, kind) {
    if (!tgt.alive) return;
    let dmg = amount;
    if (kind === 'phys') dmg *= 100 / (100 + tgt.c.armor);
    dmg *= mult(tgt, 'dmgTaken');
    dmg *= 0.95 + Math.random() * 0.1;
    dmg = Math.max(1, Math.round(dmg));
    let rest = dmg;
    if (tgt.shield > 0) {
      const a = Math.min(tgt.shield, rest);
      tgt.shield -= a; rest -= a;
    }
    tgt.hp -= rest;
    tgt.hit = 1;
    tgt.mana = Math.min(tgt.c.mana, tgt.mana + 5);
    if (src) {
      src.dmgDealt += dmg;
      const ls = lifesteal(src);
      if (ls > 0 && src.alive) heal(src, src, Math.round(dmg * ls), true);
    }
    floatText(tgt, String(dmg), kind === 'skill' ? '#ffb347' : '#ffffff', kind === 'skill' ? 1.35 : 1);
    spark(tgt.x, tgt.y, 0.35, kind === 'skill' ? 7 : 4, kind === 'skill' ? ['#ffb347', '#fff1a8'] : ['#ffffff', '#ffe08a'], 0.8, { g: 3, size: 0.8 });
    if (tgt.hp <= 0) {
      tgt.hp = 0; tgt.alive = false; tgt.deadT = 0;
      S.fx.push({ kind: 'burst', x: tgt.x, y: tgt.y, t: 0, life: 0.6, color: COLOR[tgt.team] });
      spark(tgt.x, tgt.y, 0.3, 22, [COLOR[tgt.team], PED[tgt.team][1], '#ffffff'], 1.4, { size: 1.3, life: 1.3 });
      shake(5);
      sfx.play('die');
    }
  }

  function heal(src, tgt, amount, quiet) {
    if (!tgt.alive) return;
    const real = Math.min(amount, tgt.maxHp - tgt.hp);
    tgt.hp += real;
    src.healDone += real;
    if (!quiet || real >= 15) floatText(tgt, '+' + Math.round(real), '#5ef08a', quiet ? 0.85 : 1.3);
  }

  function basicAttack(u, t) {
    const atk = u.c.atk * mult(u, 'atk');
    u.mana = Math.min(u.c.mana, u.mana + 10);
    if (u.c.range <= 1) {
      const d = dist(u, t) || 1;
      u.lunge = 1; u.lungeDir = [(t.x - u.x) / d, (t.y - u.y) / d];
      S.fx.push({ kind: 'slash', x: t.x, y: t.y, t: 0, life: 0.2, dir: u.lungeDir, team: u.team, flip: Math.random() < 0.5 });
      sfx.play('slash'); sfx.play('hit');
      dealDamage(u, t, atk, 'phys');
    } else {
      const style = { archer: 'arrow', mage: 'ember', priest: 'holy', warlock: 'shadow' }[u.c.id] || 'ember';
      sfx.play(ATTACK_SFX[u.c.id] || 'magic');
      S.projs.push({ style, team: u.team, x: u.x, y: u.y, target: t, tx: t.x, ty: t.y, speed: 9, trail: [],
        onHit: () => dealDamage(u, t, atk, 'phys') });
    }
  }

  function castSkill(u) {
    const enemies = enemiesOf(u);
    const id = u.c.id;
    const offensive = ['golem', 'assassin', 'archer', 'mage', 'warlock'].includes(id);
    if (offensive && !enemies.length) return false;
    u.cast = 1;
    skillLabel(u, u.c.skill.name);
    S.fx.push({ kind: 'castglow', x: u.x, y: u.y, t: 0, life: 0.45, color: PED[u.team][1] });

    if (id === 'knight') {
      sfx.play('guard');
      addBuff(u, { type: 'guard', t: 3, dmgTaken: 0.5 });
      alliesOf(u).filter(a => a !== u).sort((a, b) => dist(u, a) - dist(u, b)).slice(0, 2).forEach(a => {
        a.shield += 150; a.shieldT = 4;
        S.fx.push({ kind: 'ring', x: a.x, y: a.y, t: 0, life: 0.5, r: 0.6, color: '#ffe58a' });
        S.fx.push({ kind: 'beam', x: u.x, y: u.y, x2: a.x, y2: a.y, t: 0, life: 0.35, color: '#ffe58a' });
      });
      S.fx.push({ kind: 'ring', x: u.x, y: u.y, t: 0, life: 0.6, r: 1.0, color: '#ffd24a' });
    } else if (id === 'golem') {
      sfx.play('quake'); shake(12);
      S.fx.push({ kind: 'quake', x: u.x, y: u.y, t: 0, life: 0.7, r: 1.6, color: '#c8955a' });
      for (let i = 0; i < 18; i++) {
        const a = i / 18 * Math.PI * 2;
        spark(u.x + Math.cos(a) * 0.9, u.y + Math.sin(a) * 0.9, 0, 1, ['#a8784a', '#6b4a2e'], 1, { size: 1.6 });
      }
      enemies.filter(e => dist(u, e) <= 1.6).forEach(e => {
        dealDamage(u, e, 150, 'skill');
        e.stun = Math.max(e.stun, 1.5);
      });
    } else if (id === 'berserker') {
      sfx.play('rage');
      addBuff(u, { type: 'rage', t: 4, as: 1.6, ls: 0.3 });
      S.fx.push({ kind: 'ring', x: u.x, y: u.y, t: 0, life: 0.5, r: 0.9, color: '#ff3b3b' });
      spark(u.x, u.y, 0.2, 12, ['#ff3b3b', '#ff9a3c'], 1, { g: -1 });
    } else if (id === 'assassin') {
      sfx.play('teleport'); shake(4);
      const t = enemies.reduce((a, b) => (b.hp < a.hp ? b : a));
      S.fx.push({ kind: 'smoke', x: u.x, y: u.y, t: 0, life: 0.5 });
      u.x = t.x + (u.team === 'p1' ? 0.75 : -0.75); u.y = t.y; clampPos(u);
      S.fx.push({ kind: 'smoke', x: u.x, y: u.y, t: 0, life: 0.5 });
      u.target = t;
      const d = dist(u, t) || 1;
      u.lunge = 1; u.lungeDir = [(t.x - u.x) / d, (t.y - u.y) / d];
      S.fx.push({ kind: 'slash', x: t.x, y: t.y, t: 0, life: 0.3, dir: u.lungeDir, team: u.team, big: true });
      dealDamage(u, t, u.c.atk * mult(u, 'atk') * 2.0, 'skill');
    } else if (id === 'archer') {
      sfx.play('pierce');
      const t = u.target && u.target.alive ? u.target : nearest(u, enemies);
      const d = dist(u, t) || 1;
      S.projs.push({ style: 'pierce', team: u.team, x: u.x, y: u.y, dir: [(t.x - u.x) / d, (t.y - u.y) / d],
        speed: 14, travel: 0, maxTravel: 9, hitSet: new Set(), trail: [],
        onPass: e => dealDamage(u, e, 190, 'skill') });
    } else if (id === 'mage') {
      sfx.play('fireball');
      const t = u.target && u.target.alive ? u.target : nearest(u, enemies);
      S.projs.push({ style: 'fireball', team: u.team, x: u.x, y: u.y, target: t, tx: t.x, ty: t.y, speed: 7, trail: [],
        onHit: (px, py) => {
          sfx.play('explode'); shake(9);
          S.fx.push({ kind: 'explode', x: px, y: py, t: 0, life: 0.55, r: 1.2 });
          spark(px, py, 0.3, 26, ['#ff5a1f', '#ffb347', '#fff1a8'], 1.6, { size: 1.4 });
          enemiesOf(u).filter(e => Math.hypot(e.x - px, e.y - py) <= 1.2).forEach(e => dealDamage(u, e, 330, 'skill'));
        } });
    } else if (id === 'priest') {
      sfx.play('heal');
      alliesOf(u).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp).slice(0, 2).forEach(a => {
        heal(u, a, 300);
        S.fx.push({ kind: 'heal', x: a.x, y: a.y, t: 0, life: 0.9 });
        S.fx.push({ kind: 'pillar', x: a.x, y: a.y, t: 0, life: 0.6, color: '#9dffb8' });
      });
    } else if (id === 'warlock') {
      sfx.play('curse');
      const t = enemies.reduce((a, b) => (b.c.atk * mult(b, 'atk') > a.c.atk * mult(a, 'atk') ? b : a));
      S.projs.push({ style: 'curse', team: u.team, x: u.x, y: u.y, target: t, tx: t.x, ty: t.y, speed: 8, trail: [],
        onHit: () => {
          if (!t.alive) return;
          addBuff(t, { type: 'curse', t: 5, atk: 0.6, dmgTaken: 1.2 });
          dealDamage(u, t, 180, 'skill');
          spark(t.x, t.y, 0.4, 14, ['#a24bff', '#d9a8ff'], 0.9, { g: -2 });
          floatText(t, '쇠약', '#c77dff', 1);
        } });
    }
    return true;
  }

  // 암살자 패시브: 전투 시작 시 적 뒷줄로 도약
  function assassinLeaps() {
    S.units.filter(u => u.c.id === 'assassin').forEach(u => {
      const enemies = enemiesOf(u);
      if (!enemies.length) return;
      const back = enemies.filter(e => e.row === 'back');
      const t = back.length
        ? back.reduce((a, b) => (Math.abs(b.y - u.y) < Math.abs(a.y - u.y) ? b : a))
        : enemies.reduce((a, b) => (dist(u, b) > dist(u, a) ? b : a));
      const tx = Math.max(0.3, Math.min(BW - 0.3, t.x + (u.team === 'p1' ? 0.75 : -0.75)));
      u.jump = { fx: u.x, fy: u.y, tx, ty: t.y, t: 0, dur: 0.55 };
      u.target = t;
      sfx.play('teleport');
    });
  }

  function updateUnit(u, dt) {
    u.buffs.forEach(b => (b.t -= dt));
    u.buffs = u.buffs.filter(b => b.t > 0);
    if (u.shieldT > 0) { u.shieldT -= dt; if (u.shieldT <= 0) u.shield = 0; }
    if (u.atkCd > 0) u.atkCd -= dt;

    if (u.jump) {
      const j = u.jump; j.t += dt;
      const k = Math.min(1, j.t / j.dur);
      u.x = j.fx + (j.tx - j.fx) * k; u.y = j.fy + (j.ty - j.fy) * k;
      if (k >= 1) {
        u.jump = null;
        S.fx.push({ kind: 'smoke', x: u.x, y: u.y, t: 0, life: 0.45 });
        sfx.play('land');
      }
      return;
    }
    if (u.stun > 0) { u.stun -= dt; return; }

    const enemies = enemiesOf(u);
    if (!enemies.length) return;

    if (u.mana >= u.c.mana) {
      if (castSkill(u)) { u.mana = 0; return; }
    }

    u.retargetT -= dt;
    if (!u.target || !u.target.alive) u.target = nearest(u, enemies);
    else if (dist(u, u.target) > rangeOf(u) && u.retargetT <= 0) { u.target = nearest(u, enemies); u.retargetT = 0.5; }
    const t = u.target;
    const d = dist(u, t);
    const range = rangeOf(u);

    if (d > range) {
      const step = Math.min(u.c.moveSpeed * TILE_SPEED * dt, d - range + 0.02);
      u.x += (t.x - u.x) / d * step;
      u.y += (t.y - u.y) / d * step;
      u.walk = (u.walk || 0) + dt * 12;
    } else if (u.atkCd <= 0) {
      basicAttack(u, t);
      u.atkCd = 1 / (u.c.atkSpeed * mult(u, 'as'));
    }
  }

  function separate() {
    const live = S.units.filter(u => u.alive && !u.jump);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        const min = 0.72;
        if (d < min) {
          if (d < 1e-4) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); }
          const push = (min - d) / 2;
          a.x -= dx / d * push; a.y -= dy / d * push;
          b.x += dx / d * push; b.y += dy / d * push;
        }
      }
    }
    live.forEach(clampPos);
  }

  function updateProjs(dt) {
    for (const p of S.projs) {
      p.trail.push([p.x, p.y]);
      if (p.trail.length > (p.style === 'fireball' || p.style === 'pierce' ? 10 : 5)) p.trail.shift();
      if (p.style === 'fireball' && Math.random() < 0.6) spark(p.x, p.y, 0.32, 1, ['#ff9a3c', '#ffd27a'], 0.3, { g: -1, size: 1.2 });
      if (p.style === 'pierce') {
        const step = p.speed * dt;
        p.x += p.dir[0] * step; p.y += p.dir[1] * step; p.travel += step;
        S.units.forEach(e => {
          if (e.alive && e.team !== p.team && !p.hitSet.has(e) && Math.hypot(e.x - p.x, e.y - p.y) < 0.6) {
            p.hitSet.add(e); p.onPass(e);
          }
        });
        if (p.travel >= p.maxTravel || p.x < -1 || p.x > BW + 1 || p.y < -1 || p.y > BH + 1) p.done = true;
        continue;
      }
      if (p.target && p.target.alive) { p.tx = p.target.x; p.ty = p.target.y; }
      const d = Math.hypot(p.tx - p.x, p.ty - p.y);
      const step = p.speed * dt;
      if (d <= step) {
        p.x = p.tx; p.y = p.ty; p.done = true;
        if (p.style !== 'fireball') sfx.play('hit');
        p.onHit(p.x, p.y);
      } else {
        p.x += (p.tx - p.x) / d * step; p.y += (p.ty - p.y) / d * step;
      }
    }
    S.projs = S.projs.filter(p => !p.done);
  }

  // 연출용 업데이트 (전투 진행과 관계없이 항상)
  function updateVisuals(dt) {
    S.fx.forEach(f => (f.t += dt)); S.fx = S.fx.filter(f => f.t < f.life);
    S.texts.forEach(t => (t.t += dt)); S.texts = S.texts.filter(t => t.t < t.life);
    S.labels.forEach(l => (l.t += dt)); S.labels = S.labels.filter(l => l.t < l.life);
    for (const p of S.parts) {
      p.t += dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= p.g * dt;
      if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.6; p.vy *= 0.6; }
    }
    S.parts = S.parts.filter(p => p.t < p.life);
    S.shake *= Math.pow(0.0005, dt);
    if (S.shake < 0.3) S.shake = 0;
    S.flash = Math.max(0, S.flash - dt * 2.5);
    S.units.forEach(u => {
      if (!u.alive) { u.deadT += dt; return; }
      u.lunge = Math.max(0, u.lunge - dt * 5);
      u.hit = Math.max(0, u.hit - dt * 6);
      u.cast = Math.max(0, u.cast - dt * 2.5);
      u.bob += dt * 3;
    });
  }

  function update(dt) {
    updateVisuals(dt);

    if (S.phase === 'countdown') {
      S.countdown -= dt;
      const e = COUNTDOWN - S.countdown;
      S.units.forEach(u => {
        if (!u.landed && e >= u.dropDelay + 0.42) {
          u.landed = true;
          shake(3);
          S.fx.push({ kind: 'ring', x: u.x, y: u.y, t: 0, life: 0.4, r: 0.5, color: PED[u.team][1] });
          spark(u.x, u.y, 0, 8, ['#cfc6e6', '#8f86a8'], 0.7, { size: 1.1 });
          sfx.play('land');
        }
      });
      const n = Math.ceil(S.countdown);
      if (n !== S.lastCount && n >= 1 && n <= 3) { S.lastCount = n; sfx.play('count'); }
      if (S.countdown <= 0) { S.phase = 'fight'; sfx.play('go'); assassinLeaps(); S.goT = 0.8; }
      return;
    }
    if (S.goT > 0) S.goT -= dt;
    if (S.phase !== 'fight') return;

    S.time += dt;
    S.units.filter(u => u.alive).forEach(u => updateUnit(u, dt));
    separate();
    updateProjs(dt);

    const alive = t => S.units.some(u => u.alive && u.team === t);
    if (!alive('p1') || !alive('p2')) endBattle(alive('p1') ? 'p1' : alive('p2') ? 'p2' : 'draw', false);
    else if (S.time >= TIME_LIMIT) {
      const ratio = t => S.units.filter(u => u.team === t).reduce((s, u) => s + u.hp / u.maxHp, 0);
      const r1 = ratio('p1'), r2 = ratio('p2');
      endBattle(Math.abs(r1 - r2) < 0.01 ? 'draw' : r1 > r2 ? 'p1' : 'p2', true);
    }
  }

  function endBattle(winner, timeout) {
    S.phase = 'end'; S.winner = winner;
    S.slowmo = 1.1; S.flash = 0.8;
    S.projs = [];
    setTimeout(() => sfx.play('win'), 500);
    setTimeout(() => {
      const title = $('resultTitle');
      title.className = 'result-title ' + (winner === 'draw' ? '' : winner);
      title.textContent = winner === 'draw' ? '무승부' : winner.toUpperCase() + ' 승리!';
      $('resultSub').textContent = timeout ? '시간 종료 · 남은 체력 비교' : '전투 종료';
      const mvp = S.units.reduce((a, b) => (b.dmgDealt + b.healDone > a.dmgDealt + a.healDone ? b : a));
      $('mvp').innerHTML = `MVP <b>${mvp.team.toUpperCase()} ${mvp.c.icon} ${mvp.c.name}</b> · 피해 ${mvp.dmgDealt}${mvp.healDone ? ' · 회복 ' + mvp.healDone : ''}`;
      $('result').hidden = false;
    }, 1700);
  }

  // ---------- HUD ----------
  let hudEls = [];
  function buildHud() {
    hudEls = [];
    for (const team of ['p1', 'p2']) {
      const box = $(team === 'p1' ? 'hudP1' : 'hudP2');
      box.innerHTML = '';
      S.units.filter(u => u.team === team).forEach(u => {
        const el = document.createElement('div');
        el.className = 'hu';
        el.innerHTML = `<div class="i">${u.c.icon}</div><div class="n">${u.c.name}</div>
          <div class="bar"><i class="lag"></i><i class="cur"></i></div><div class="bar mp"><i></i></div>`;
        box.appendChild(el);
        hudEls.push({ u, el, hp: el.querySelector('.cur'), lag: el.querySelector('.lag'), mp: el.querySelector('.mp > i'), lastHp: u.hp });
      });
    }
  }
  function updateHud() {
    hudEls.forEach(h => {
      const pct = h.u.hp / h.u.maxHp * 100;
      h.hp.style.width = pct + '%';
      h.lag.style.width = pct + '%';
      h.mp.style.width = (h.u.mana / h.u.c.mana * 100) + '%';
      if (h.u.hp < h.lastHp) { h.el.classList.remove('hit'); void h.el.offsetWidth; h.el.classList.add('hit'); }
      h.lastHp = h.u.hp;
      h.el.classList.toggle('dead', !h.u.alive);
      h.el.classList.toggle('ready', h.u.alive && h.u.mana / h.u.c.mana >= 0.85);
    });
    const left = Math.max(0, Math.ceil(TIME_LIMIT - S.time));
    $('timer').textContent = left;
    $('timer').classList.toggle('low', left <= 10);
  }

  // ---------- 렌더링 (아이소메트릭) ----------
  const canvas = $('board'), ctx = canvas.getContext('2d');
  let W, H, DPR, tw, th, ox, oy;
  function resize() {
    DPR = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    tw = Math.min(W * 0.84 / ((BW + BH) / 2), (H - 170) / 3.5);
    th = tw / 2;
    const cx = W / 2, cy = 110 + (H - 110) / 2;
    ox = cx - (BW / 2 - BH / 2) * tw / 2;
    oy = cy - (BW / 2 + BH / 2) * th / 2;
  }
  window.addEventListener('resize', resize);
  const iso = (x, y) => [ox + (x - y) * tw / 2, oy + (x + y) * th / 2];
  const ZPX = () => tw * 0.5; // 높이 1 = 화면 px

  // 배경에 떠다니는 불씨
  const embers = Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random(), s: rand(1, 2.6), v: rand(0.01, 0.035), w: rand(0, 6) }));
  function drawAmbient(dt) {
    ctx.save();
    embers.forEach(e => {
      e.y -= e.v * dt; e.w += dt;
      if (e.y < -0.02) { e.y = 1.02; e.x = Math.random(); }
      const x = (e.x + Math.sin(e.w) * 0.01) * W, y = e.y * H;
      ctx.globalAlpha = 0.25 + Math.sin(e.w * 2) * 0.15;
      ctx.fillStyle = '#f2c35b';
      ctx.beginPath(); ctx.arc(x, y, e.s, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }

  function diamond(x0, y0, x1, y1) {
    const pts = [iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1)];
    ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath();
  }

  function drawBoard() {
    const depth = tw * 0.22;
    const A = iso(BW, 0), B = iso(BW, BH), C = iso(0, BH);
    ctx.fillStyle = '#100d18';
    ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(...B); ctx.lineTo(B[0], B[1] + depth); ctx.lineTo(A[0], A[1] + depth); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1b1528';
    ctx.beginPath(); ctx.moveTo(...C); ctx.lineTo(...B); ctx.lineTo(B[0], B[1] + depth); ctx.lineTo(C[0], C[1] + depth); ctx.closePath(); ctx.fill();

    for (let i = 0; i < BW; i++) {
      for (let j = 0; j < BH; j++) {
        const team = i < BW / 2 ? 'p1' : 'p2';
        const light = (i + j) % 2 === 0;
        ctx.fillStyle = team === 'p1' ? (light ? '#3a2733' : '#30212c') : (light ? '#26304a' : '#202940');
        diamond(i, j, i + 1, j + 1); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    // 진영별 은은한 빛
    const glow = (x, y, color) => {
      const [sx, sy] = iso(x, y);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, tw * 2.2);
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); diamond(0, 0, BW, BH); ctx.clip(); ctx.fillStyle = g; ctx.fillRect(sx - tw * 3, sy - tw * 3, tw * 6, tw * 6); ctx.restore();
    };
    glow(1.5, 2, 'rgba(229,64,77,.13)');
    glow(6.5, 2, 'rgba(61,125,255,.13)');

    const m0 = iso(BW / 2, 0), m1 = iso(BW / 2, BH);
    ctx.save();
    ctx.strokeStyle = 'rgba(242,195,91,.45)'; ctx.lineWidth = 2; ctx.shadowColor = '#f2c35b'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(...m0); ctx.lineTo(...m1); ctx.stroke();
    ctx.restore();
    diamond(0, 0, BW, BH); ctx.strokeStyle = 'rgba(242,195,91,.25)'; ctx.lineWidth = 2; ctx.stroke();
  }

  function groundEllipse(x, y, r, stroke, fill, lw = 3) {
    const [sx, sy] = iso(x, y);
    ctx.beginPath(); ctx.ellipse(sx, sy, r * tw / 2 * 1.41, r * th / 2 * 1.41, 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }

  // 실물 말 받침 (원기둥)
  function drawPedestal(sx, sy, team, lift) {
    const rx = tw * 0.21, ry = rx * 0.5, h = tw * 0.075;
    const [side, inner, outer] = PED[team];
    const top = sy - h - lift;
    // 그림자 (공중에 있으면 작고 옅게)
    const sh = Math.max(0.3, 1 - lift / (tw * 1.5));
    ctx.fillStyle = `rgba(0,0,0,${0.4 * sh})`;
    ctx.beginPath(); ctx.ellipse(sx, sy + 2, rx * 1.15 * sh, ry * 1.15 * sh, 0, 0, Math.PI * 2); ctx.fill();
    // 옆면
    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.ellipse(sx, top + h, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(sx - rx, top);
    ctx.ellipse(sx, top, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath(); ctx.fill();
    // 윗면
    const g = ctx.createRadialGradient(sx - rx * 0.3, top - ry * 0.3, 1, sx, top, rx);
    g.addColorStop(0, inner); g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(sx, top, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.2; ctx.stroke();
    return top;
  }

  function unitScreen(u) {
    let x = u.x, y = u.y, lift = 0;
    if (u.jump) lift = Math.sin(Math.min(1, u.jump.t / u.jump.dur) * Math.PI) * tw * 0.9;
    if (S.phase === 'countdown' && !u.landed) {
      const e = COUNTDOWN - S.countdown;
      const k = Math.max(0, Math.min(1, (e - u.dropDelay) / 0.42));
      lift = (1 - k * k) * tw * 3.2;
      if (e < u.dropDelay) return null;
    }
    if (u.lunge > 0) {
      const k = Math.sin(u.lunge * Math.PI) * 0.28;
      x += u.lungeDir[0] * k; y += u.lungeDir[1] * k;
    }
    const [sx, sy] = iso(x, y);
    return { sx, sy, lift };
  }

  function drawUnit(u) {
    let alpha = 1;
    if (!u.alive) { alpha = Math.max(0, 1 - u.deadT / 0.6); if (alpha <= 0) return; }
    const p = unitScreen(u);
    if (!p) return;
    const { sx, sy, lift } = p;
    ctx.save();
    ctx.globalAlpha = alpha;

    const top = drawPedestal(sx, sy, u.team, lift);
    const has = t => u.buffs.some(b => b.type === t);
    const auraY = top - tw * 0.17;
    if (has('rage')) { ctx.fillStyle = 'rgba(255,40,40,.2)'; ctx.beginPath(); ctx.ellipse(sx, auraY, tw * 0.23, tw * 0.27, 0, 0, Math.PI * 2); ctx.fill(); }
    if (has('curse')) { ctx.fillStyle = 'rgba(160,70,255,.24)'; ctx.beginPath(); ctx.ellipse(sx, auraY, tw * 0.23, tw * 0.27, 0, 0, Math.PI * 2); ctx.fill(); }

    // 몸 (이모지) - 걷기/숨쉬기/공격 기울기
    const bob = u.alive && !u.stun ? Math.sin(u.bob) * tw * 0.012 : 0;
    const hop = u.walk && u.alive ? Math.abs(Math.sin(u.walk)) * tw * 0.03 : 0;
    const size = tw * 0.32 * (1 + u.cast * 0.3);
    const by = top - size * 0.42 - bob - hop;
    const lean = u.lunge > 0 ? Math.sin(u.lunge * Math.PI) * 0.35 * Math.sign(iso(u.lungeDir[0], u.lungeDir[1])[0] - iso(0, 0)[0] || 1) : 0;
    const deadTilt = !u.alive ? u.deadT * 2.2 : 0;
    ctx.save();
    ctx.translate(sx, by + size * 0.4);
    ctx.rotate(lean + deadTilt);
    if (u.team === 'p2') ctx.scale(-1, 1);
    ctx.font = `${size}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    if (u.hit > 0.3) ctx.filter = 'brightness(2.4)';
    else if (u.stun > 0) ctx.filter = 'grayscale(.6)';
    ctx.fillText(u.c.icon, 0, -size * 0.4);
    ctx.restore();

    if (has('guard')) { ctx.strokeStyle = 'rgba(255,214,90,.95)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(sx, auraY, tw * 0.25, tw * 0.29, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (u.shield > 0) {
      ctx.fillStyle = 'rgba(200,230,255,.13)'; ctx.strokeStyle = 'rgba(220,240,255,.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(sx, auraY, tw * 0.27, tw * 0.31, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    if (u.stun > 0) {
      ctx.font = `${tw * 0.13}px ${EMOJI_FONT}`; ctx.textAlign = 'center';
      const a = performance.now() / 200;
      for (let i = 0; i < 3; i++) ctx.fillText('⭐', sx + Math.cos(a + i * 2.1) * tw * 0.15, by - size * 0.55 + Math.sin(a + i * 2.1) * tw * 0.04);
    }

    // 체력/마나 바
    if (u.alive && S.phase !== 'countdown') {
      const bw = tw * 0.42, bh = Math.max(5, tw * 0.04), bx = sx - bw / 2, bY = by - size * 0.62 - bh * 2;
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(bx - 1.5, bY - 1.5, bw + 3, bh + bh * 0.6 + 4);
      ctx.fillStyle = COLOR[u.team]; ctx.fillRect(bx, bY, bw * u.hp / u.maxHp, bh);
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(bx, bY, bw * u.hp / u.maxHp, bh * 0.4);
      // 칸 구분선 (200 체력마다)
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      for (let v = 200; v < u.maxHp; v += 200) ctx.fillRect(bx + bw * v / u.maxHp, bY, 1, bh);
      if (u.shield > 0) { ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(bx + bw * u.hp / u.maxHp, bY, Math.min(bw * u.shield / u.maxHp, bw * (1 - u.hp / u.maxHp)), bh); }
      const full = u.mana / u.c.mana;
      ctx.fillStyle = full >= 0.85 ? '#b8e6ff' : '#5fb8ff'; ctx.fillRect(bx, bY + bh + 1.5, bw * full, bh * 0.6);
    }
    ctx.restore();
  }

  function drawProj(p) {
    ctx.save();
    const Z = tw * 0.2;
    const pt = (x, y) => { const [a, b] = iso(x, y); return [a, b - Z]; };
    const [sx, sy] = pt(p.x, p.y);
    if (p.style === 'arrow' || p.style === 'pierce') {
      const dir = p.dir || (() => { const d = Math.hypot(p.tx - p.x, p.ty - p.y) || 1; return [(p.tx - p.x) / d, (p.ty - p.y) / d]; })();
      if (p.style === 'pierce') {
        // 빛줄기 잔상
        ctx.lineCap = 'round';
        const t0 = p.trail[0] ? pt(...p.trail[0]) : [sx, sy];
        const g = ctx.createLinearGradient(t0[0], t0[1], sx, sy);
        g.addColorStop(0, 'rgba(255,216,74,0)'); g.addColorStop(1, 'rgba(255,240,170,.9)');
        ctx.strokeStyle = g; ctx.lineWidth = tw * 0.07; ctx.shadowColor = '#ffd84a'; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.moveTo(...t0); ctx.lineTo(sx, sy); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = tw * 0.02;
        ctx.beginPath(); ctx.moveTo(...t0); ctx.lineTo(sx, sy); ctx.stroke();
      } else {
        const [ex, ey] = pt(p.x - dir[0] * 0.4, p.y - dir[1] * 0.4);
        ctx.strokeStyle = '#e9dcc0'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(sx, sy); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      const cfg = {
        ember: ['#ff9a3c', 6], holy: ['#fff6a0', 6], shadow: ['#b26bff', 6],
        fireball: ['#ff5a1f', 16], curse: ['#a24bff', 11],
      }[p.style];
      const r = cfg[1] * tw / 110;
      p.trail.forEach(([x, y], i) => {
        const [a, b] = pt(x, y); const k = (i + 1) / p.trail.length;
        ctx.globalAlpha = k * 0.45; ctx.fillStyle = cfg[0];
        ctx.beginPath(); ctx.arc(a, b, r * k, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.shadowColor = cfg[0]; ctx.shadowBlur = cfg[1] * 2.4;
      ctx.fillStyle = cfg[0];
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, r * 0.45, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawFx(f) {
    const k = f.t / f.life;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    if (f.kind === 'ring') groundEllipse(f.x, f.y, f.r * (0.4 + k * 0.8), f.color, null, 4);
    else if (f.kind === 'quake') {
      groundEllipse(f.x, f.y, f.r * Math.min(1, k * 1.6), f.color, 'rgba(200,149,90,.25)', 7);
      groundEllipse(f.x, f.y, f.r * Math.min(1, k * 1.6) * 0.6, f.color, null, 3);
    } else if (f.kind === 'explode') {
      groundEllipse(f.x, f.y, f.r * (0.3 + k * 0.8), '#ffcf5a', 'rgba(255,90,30,.45)', 5);
      const [sx, sy] = iso(f.x, f.y);
      const g = ctx.createRadialGradient(sx, sy - tw * 0.2, 0, sx, sy - tw * 0.2, tw * 0.6 * (0.4 + k));
      g.addColorStop(0, 'rgba(255,255,200,.95)'); g.addColorStop(0.4, 'rgba(255,150,40,.75)'); g.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy - tw * 0.2, tw * 0.6 * (0.4 + k), 0, Math.PI * 2); ctx.fill();
    } else if (f.kind === 'burst') {
      const [sx, sy] = iso(f.x, f.y);
      ctx.strokeStyle = f.color; ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2, r0 = tw * 0.12 + k * tw * 0.22, r1 = r0 + tw * 0.12;
        ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * r0, sy - tw * 0.2 + Math.sin(a) * r0); ctx.lineTo(sx + Math.cos(a) * r1, sy - tw * 0.2 + Math.sin(a) * r1); ctx.stroke();
      }
    } else if (f.kind === 'slash') {
      const [sx, sy] = iso(f.x, f.y);
      const cy = sy - tw * 0.2;
      const ang = Math.atan2(iso(f.dir[0], f.dir[1])[1] - iso(0, 0)[1], iso(f.dir[0], f.dir[1])[0] - iso(0, 0)[0]);
      const r = tw * (f.big ? 0.32 : 0.2);
      const sweep = Math.PI * 0.9 * Math.min(1, k * 2.2);
      const start = ang - Math.PI * 0.45;
      ctx.lineCap = 'round';
      ctx.shadowColor = COLOR[f.team]; ctx.shadowBlur = 12;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = f.big ? 5 : 3.5;
      ctx.beginPath();
      if (f.flip) ctx.arc(sx, cy, r, start + Math.PI * 0.9, start + Math.PI * 0.9 - sweep, true);
      else ctx.arc(sx, cy, r, start, start + sweep);
      ctx.stroke();
    } else if (f.kind === 'smoke') {
      const [sx, sy] = iso(f.x, f.y);
      ctx.fillStyle = 'rgba(90,80,110,.75)';
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; ctx.beginPath(); ctx.arc(sx + Math.cos(a) * tw * 0.18 * (0.5 + k), sy - tw * 0.15 + Math.sin(a) * tw * 0.08 * (0.5 + k) - k * tw * 0.1, tw * 0.1 * (1 + k * 0.5), 0, Math.PI * 2); ctx.fill(); }
    } else if (f.kind === 'heal') {
      const [sx, sy] = iso(f.x, f.y);
      ctx.fillStyle = '#7dffa0'; ctx.shadowColor = '#7dffa0'; ctx.shadowBlur = 8;
      for (let i = 0; i < 6; i++) {
        const ax = sx + Math.sin(i * 2.1) * tw * 0.2, ay = sy - tw * 0.05 - k * tw * 0.55 - (i % 3) * tw * 0.08;
        ctx.fillRect(ax - 2, ay - 6, 4, 12); ctx.fillRect(ax - 6, ay - 2, 12, 4);
      }
    } else if (f.kind === 'pillar') {
      const [sx, sy] = iso(f.x, f.y);
      const g = ctx.createLinearGradient(0, sy - tw * 0.9, 0, sy);
      g.addColorStop(0, 'rgba(157,255,184,0)'); g.addColorStop(1, 'rgba(157,255,184,.5)');
      ctx.fillStyle = g; ctx.fillRect(sx - tw * 0.16, sy - tw * 0.9, tw * 0.32, tw * 0.9);
    } else if (f.kind === 'castglow') {
      groundEllipse(f.x, f.y, 0.35 + k * 0.35, f.color, null, 3);
    } else if (f.kind === 'beam') {
      const [a, b] = iso(f.x, f.y), [c, d] = iso(f.x2, f.y2);
      ctx.strokeStyle = f.color; ctx.lineWidth = 3; ctx.shadowColor = f.color; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(a, b - tw * 0.2); ctx.lineTo(c, d - tw * 0.2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawParts() {
    ctx.save();
    S.parts.forEach(p => {
      const [sx, sy] = iso(p.x, p.y);
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(sx - p.size / 2, sy - p.z * ZPX() - p.size / 2, p.size, p.size);
    });
    ctx.restore();
  }

  function drawTexts() {
    S.texts.forEach(t => {
      const k = t.t / t.life;
      const [sx, sy] = iso(t.x + t.jitter, t.y);
      const pop = 1 + 0.6 * Math.max(0, 1 - t.t / 0.12);
      ctx.save();
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.font = `900 ${Math.round(tw * 0.12 * t.size * pop)}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.8)';
      const y = sy - tw * 0.62 - k * tw * 0.3;
      ctx.strokeText(t.text, sx, y); ctx.fillStyle = t.color; ctx.fillText(t.text, sx, y);
      ctx.restore();
    });
  }

  function drawLabels() {
    S.labels.forEach(l => {
      if (!l.u.alive && l.u.deadT > 0.3) return;
      const p = unitScreen(l.u); if (!p) return;
      const k = l.t / l.life;
      const pop = Math.min(1, l.t / 0.12);
      ctx.save();
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      const fs = Math.round(tw * 0.1);
      ctx.font = `900 ${fs}px ${UI_FONT}`;
      const w = ctx.measureText(l.text).width + fs * 1.2, h = fs * 1.6;
      const x = p.sx, y = p.sy - tw * 0.82 - k * tw * 0.08;
      ctx.translate(x, y); ctx.scale(0.6 + pop * 0.4, 0.6 + pop * 0.4);
      ctx.fillStyle = PED[l.u.team][0]; ctx.strokeStyle = PED[l.u.team][1]; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, h / 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(l.text, 0, 1);
      ctx.restore();
    });
  }

  function drawCenterText(text, color, scale, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `900 ${Math.round(tw * 0.7 * scale)}px ${UI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.strokeText(text, W / 2, H / 2); ctx.fillStyle = color; ctx.fillText(text, W / 2, H / 2);
    ctx.restore();
  }

  function render(rdt) {
    ctx.clearRect(0, 0, W, H);
    drawAmbient(rdt);
    ctx.save();
    if (S.shake > 0) ctx.translate(rand(-1, 1) * S.shake, rand(-1, 1) * S.shake * 0.6);
    drawBoard();
    S.fx.filter(f => ['ring', 'quake', 'explode', 'castglow'].includes(f.kind)).forEach(drawFx);
    [...S.units].sort((a, b) => (a.x + a.y) - (b.x + b.y)).forEach(drawUnit);
    S.projs.forEach(drawProj);
    S.fx.filter(f => !['ring', 'quake', 'explode', 'castglow'].includes(f.kind)).forEach(drawFx);
    drawParts();
    drawTexts();
    drawLabels();
    ctx.restore();

    if (S.phase === 'countdown') {
      const n = Math.ceil(S.countdown);
      const frac = S.countdown - Math.floor(S.countdown);
      if (n >= 1 && n <= 3) drawCenterText(String(n), '#f2c35b', 1 + frac * 0.4, Math.min(1, frac * 3 + 0.2));
    } else if (S.goT > 0) drawCenterText('전투!', '#ffffff', 1 + S.goT * 0.3, Math.min(1, S.goT * 2));
    if (S.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${S.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- 루프 ----------
  let speed = 1, last = performance.now(), acc = 0;
  const STEP = 1 / 60;
  function loop(now) {
    requestAnimationFrame(loop);
    const rdt = Math.min(0.1, (now - last) / 1000);
    last = now;
    let scale = speed;
    if (S.slowmo > 0) { S.slowmo -= rdt; scale = 0.3; }
    acc += rdt * scale;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    render(rdt);
    updateHud();
  }

  $('speedBtn').onclick = () => {
    speed = speed === 1 ? 2 : speed === 2 ? 3 : 1;
    $('speedBtn').textContent = '속도 ' + speed + 'x';
  };
  const muteBtn = $('muteBtn');
  const syncMute = () => { muteBtn.textContent = sfx.muted ? '🔇 소리 꺼짐' : '🔊 소리 켜짐'; };
  muteBtn.onclick = () => { sfx.setMuted(!sfx.muted); syncMute(); };
  syncMute();
  $('againBtn').onclick = newBattle;

  // 테스트/자동화를 위한 훅
  window.__chato = {
    get state() { return S; },
    step: (sec) => { sfx.silent = true; for (let i = 0; i < sec * 60 && S.phase !== 'end'; i++) update(STEP); sfx.silent = false; },
    reset: (t) => { if (t) teams = t; newBattle(); },
  };

  resize();
  newBattle();
  requestAnimationFrame(loop);
})();
