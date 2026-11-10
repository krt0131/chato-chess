// 공통 데이터/규칙 (등록 화면과 전투 화면이 같이 씀)
window.Chato = window.Chato || {};

Chato.MAX_UNITS = 4;
Chato.COLS = 4; // 한 줄에 4칸 (앞줄/뒷줄 2줄)
Chato.STORAGE_KEY = 'chato.teams';

Chato.loadCharacters = async function () {
  const res = await fetch('data/characters.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('characters.json 로드 실패');
  const json = await res.json();
  const byId = {};
  json.characters.forEach((c, i) => { byId[c.id] = { ...c, order: i }; });
  return { list: json.characters, byId, rules: json.rules };
};

// "CHATO:P1:knight" → { team: 'p1', id: 'knight' }
Chato.parseQR = function (text) {
  const m = /^CHATO:(P[12]):([a-z]+)$/.exec(String(text).trim());
  return m ? { team: m[1].toLowerCase(), id: m[2] } : null;
};

// 등록 순서대로, 역할(front/back)에 맞는 줄의 가운데부터 채움
// 한 줄이 넘치면 다른 줄로 보냄
Chato.placeTeam = function (ids, byId) {
  const rows = { front: [], back: [] };
  ids.forEach(id => {
    const want = byId[id].row;
    const other = want === 'front' ? 'back' : 'front';
    (rows[want].length < Chato.COLS ? rows[want] : rows[other]).push(id);
  });
  const out = [];
  for (const row of ['front', 'back']) {
    const n = rows[row].length;
    const start = Math.floor((Chato.COLS - n) / 2);
    rows[row].forEach((id, i) => out.push({ id, row, col: start + i }));
  }
  return out;
};

Chato.saveTeams = function (teams) {
  try { sessionStorage.setItem(Chato.STORAGE_KEY, JSON.stringify(teams)); } catch (e) {}
};
Chato.loadTeams = function () {
  try {
    const t = JSON.parse(sessionStorage.getItem(Chato.STORAGE_KEY));
    if (t && Array.isArray(t.p1) && Array.isArray(t.p2)) return t;
  } catch (e) {}
  return { p1: [], p2: [] };
};
