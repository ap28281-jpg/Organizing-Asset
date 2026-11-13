/**
 * 만나장부 — 폰 안 저장 엔진 (안드로이드 앱 전용)
 * 구글 시트 대신 이 폰의 저장소(localStorage)를 쓴다. 해석·계산은 core.js(=Apps Script와 같은 코드)를 그대로 사용.
 */
const Local = (() => {
  const K = { rows: 'm.rows', raw: 'm.raw', cfg: 'm.cfg', fixed: 'm.fixed', rules: 'm.rules', fx: 'm.fx' };
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const fmt = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const now = () => fmt(Date.now());
  const newId = () => Math.random().toString(36).slice(2, 12);

  function ensure() {
    if (!get(K.cfg)) {
      const c = {};
      DEFAULT_CONFIG.forEach((r) => { c[r[0]] = r[0] === 'USDKRW' ? 0 : r[1]; });
      set(K.cfg, c);
    }
    if (!get(K.rules)) set(K.rules, DEFAULT_RULES.map((r) => ({ name: r[0], kind: r[1], app: r[2], word: r[3], active: r[4] !== 'N', memo: r[5] || '' })));
    if (!get(K.fixed)) set(K.fixed, []);
    if (!get(K.rows)) set(K.rows, []);
    if (!get(K.raw)) set(K.raw, []);
  }

  function cfg() {
    const c = get(K.cfg, {});
    const fx = get(K.fx);
    c.USDKRW = fx && fx.rate ? fx.rate : 0;
    return c;
  }

  async function refreshFx() {
    const fx = get(K.fx);
    if (fx && Date.now() - fx.at < 12 * 3600e3) return;
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/USD');
      const j = await r.json();
      if (j.rates && j.rates.KRW) set(K.fx, { rate: j.rates.KRW, at: Date.now() });
    } catch (e) { /* 오프라인이면 다음에 */ }
  }

  function slim(p) {
    return { id: p.id, time: p.time, source: p.source, type: p.type, desc: p.desc, amount: p.amount, dir: p.dir,
      months: p.months || 1, cls: p.cls, currency: p.currency || 'KRW', fx: p.fx ?? null,
      balance: p.balance ?? null, cumulative: p.cumulative ?? null, cycle: p.cycle || '', key: p.key || '' };
  }

  /** 신용카드: 달러 금액 확정 + 누적으로 놓친 결제 찾기 (Code.gs handleCard_ 와 같은 규칙) */
  function handleCard(p, rows, c) {
    const sd = Number(c['사이클시작일']) || 1, cyc = cycleKeyOf(p.time, sd);
    let prev = null, later = false;
    rows.forEach((r) => {
      if (!isCardType(r.type) || r.source !== p.source || r.cumulative === null || r.cumulative === undefined) return;
      if (cycleKeyOf(r.time, sd) !== cyc) return;
      if (dtNum(r.time) <= dtNum(p.time)) { if (!prev || dtNum(r.time) >= dtNum(prev.time)) prev = r; }
      else later = true;
    });
    if (p.currency === 'USD' && !p.amount) {
      if (prev && p.cumulative !== null && p.cumulative > prev.cumulative) { p.amount = p.cumulative - prev.cumulative; p.desc += ' (원화 승인액)'; }
      else if (c.USDKRW) { p.amount = convertUsd(p.fx, c.USDKRW, Number(c['해외수수료율']) || 0); p.desc += ' (예상)'; }
      else { p.desc += ' (환율 없음·금액 확인 필요)'; }
    }
    if (later) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const g = rows[i];
        if (g.type === '카드누락추정' && g.source === p.source && g.cls === '생활' && g.amount === p.amount && g.dir === p.dir && daysBetween(g.time, p.time) <= 3) {
          g.cls = '제외'; g.desc += ' → 나중에 온 알림으로 확인됨'; return;
        }
      }
      return;
    }
    const gap = prev ? kbCumGap(prev.cumulative, p) : 0;
    if (gap !== 0) {
      rows.push(slim({ id: newId(), time: p.time, source: p.source, type: '카드누락추정',
        desc: gap > 0 ? '알림 없이 승인된 카드 결제 (누적으로 찾음)' : '알림 없이 취소된 카드 결제 (누적으로 찾음)',
        amount: Math.abs(gap), dir: gap > 0 ? -1 : 1, months: 1, cls: '생활' }));
    }
  }

  /** 은행·페이·체크카드: 잔액 대사 (Code.gs handleBank_ 와 같은 규칙) */
  function handleBank(p, rows) {
    if (p.balance === null || p.balance === undefined || p.noBalanceCheck) return;
    const recent = rows.filter((r) => isBankType(r.type) && r.source === p.source && r.balance !== null && r.balance !== undefined).slice(-10);
    const openGaps = rows.filter((r) => r.type === '잔액차이' && r.source === p.source && r.cls === '생활' && daysBetween(r.time, p.time) <= 3);
    const d = decideToss(recent, p, openGaps);
    if (d.resolveId) rows.forEach((r) => { if (r.id === d.resolveId) { r.cls = '제외'; r.desc += ' → 나중에 온 알림으로 확인됨'; } });
    if (d.gap) {
      rows.push(slim({ id: newId(), time: p.time, source: p.source, type: '잔액차이', desc: '알림 없이 움직인 돈',
        amount: Math.abs(d.gap), dir: d.gap > 0 ? 1 : -1, months: 1, cls: '생활' }));
    }
  }

  /** 알림 하나 처리. n = {time(ms), app, title, text} */
  function ingest(n) {
    ensure();
    const rows = get(K.rows, []), c = cfg(), fixed = get(K.fixed, []), rules = get(K.rules, []);
    const t = fmt(n.time || Date.now()), title = n.title || '', text = n.text || '', app = n.app || '';
    const blob = title + '\n' + text;
    const res = parseNotification(rules, app, title, text, t);
    if (!res.list.length) {
      if (looksLikeMoney(blob) && (res.matched || !/카카오톡|kakaotalk/i.test(app))) {
        const raw = get(K.raw, []);
        raw.push({ id: newId(), time: t, app, title, text, status: '미해석' });
        set(K.raw, raw.slice(-200));
      }
      return [];
    }
    const seen = new Set(rows.map((r) => r.key).filter(Boolean)), added = [];
    res.list.forEach((p) => {
      p.key = dedupKey(p);
      if (p.key && seen.has(p.key)) return;
      if (p.key) seen.add(p.key);
      p.cls = classify(p, fixed, c['이름'], c['수입키워드']);
      p.id = newId();
      if (isCardType(p.type)) handleCard(p, rows, c); else handleBank(p, rows);
      rows.push(slim(p));
      added.push(p);
    });
    set(K.rows, rows);
    return added;
  }

  /** 앱이 열릴 때: 폰이 모아둔 알림을 꺼내서 처리 */
  function drainNative() {
    if (!window.Android || !window.Android.drain) return 0;
    let q = [];
    try { q = JSON.parse(window.Android.drain() || '[]'); } catch (e) { q = []; }
    q.sort((a, b) => a.time - b.time).forEach((n) => { try { ingest(n); } catch (e) { console.log(e); } });
    return q.length;
  }

  function summary(cycle) {
    ensure();
    const c = cfg();
    const s = computeSummary(get(K.rows, []), get(K.fixed, []), c, now(), cycle || null);
    s.unparsed = get(K.raw, []).filter((u) => u.status === '미해석').slice(-20).reverse()
      .map((u) => Object.assign({}, u, { amounts: amountsIn((u.title || '') + ' ' + (u.text || '')) }));
    s.rules = get(K.rules, []);
    s.fixedList = get(K.fixed, []);
    s.native = true;
    return s;
  }

  function fix(p) {
    const raw = get(K.raw, []), u = raw.find((x) => x.id === p.rawId);
    if (!u) throw new Error('알림을 찾지 못했어요');
    if (p.kind === 'ignore') { u.status = '무시'; set(K.raw, raw); return; }
    const amount = toInt(p.amount);
    if (!(amount > 0)) throw new Error('금액을 확인해주세요');
    const map = { card: ['카드승인', -1, '신용카드'], check: ['체크결제', -1, '체크카드'], out: ['출금', -1, '은행·페이'], in: ['입금', 1, '은행·페이'] };
    const m = map[p.kind];
    if (!m) throw new Error('종류를 골라주세요');
    const name = String(p.name || u.app || '직접 입력').trim().slice(0, 20), c = cfg();
    const o = { id: newId(), time: u.time, source: aliasSource(name), type: m[0], desc: String(p.desc || '(이름 미상)').trim().slice(0, 40),
      amount, dir: m[1], months: p.kind === 'card' ? Math.max(1, toInt(p.months) || 1) : 1, balance: null };
    o.cls = classify(o, get(K.fixed, []), c['이름'], c['수입키워드']);
    const rows = get(K.rows, []); rows.push(slim(o)); set(K.rows, rows);
    u.status = '직접처리'; set(K.raw, raw);
    if (p.learn && String(p.word || '').trim()) {
      const rules = get(K.rules, []);
      rules.unshift({ name, kind: m[2], app: escapeRe(u.app || ''), word: escapeRe(String(p.word).trim()), active: true, memo: '앱에서 직접 추가 (' + now().slice(0, 10) + ')' });
      set(K.rules, rules);
    }
  }

  function edit(id, amount, desc) {
    const rows = get(K.rows, []), r = rows.find((x) => x.id === id);
    if (!r) throw new Error('거래를 찾지 못했어요');
    if (amount !== undefined && amount !== null && amount !== '') {
      const n = toInt(amount); if (!(n > 0)) throw new Error('금액을 확인해주세요'); r.amount = n;
    }
    if (desc && String(desc).trim()) r.desc = String(desc).trim().slice(0, 40);
    set(K.rows, rows);
  }

  function reclass(id, cls) {
    if (CLASSES.indexOf(cls) < 0) throw new Error('분류 이름이 올바르지 않아요');
    const rows = get(K.rows, []), r = rows.find((x) => x.id === id);
    if (!r) throw new Error('거래를 찾지 못했어요');
    r.cls = cls; set(K.rows, rows);
  }

  function saveSettings(s) {
    const c = get(K.cfg, {});
    ['이름', '수입이름', '카드대금부담'].forEach((k) => { if (s[k] !== undefined) c[k] = String(s[k]).trim(); });
    ['월수입', '생활비예산', '카드한도'].forEach((k) => { if (s[k] !== undefined) c[k] = Math.max(0, toInt(s[k])); });
    ['사이클시작일', '결제일'].forEach((k) => { if (s[k] !== undefined) c[k] = Math.min(28, Math.max(1, toInt(s[k]) || 1)); });
    c['설정완료'] = 'Y';
    set(K.cfg, c);
  }

  function saveRule(i, r) {
    const rules = get(K.rules, []);
    const o = { name: String(r.name || '').trim().slice(0, 20), kind: r.kind || '은행·페이', app: String(r.app || '').trim(),
      word: String(r.word || '').trim(), active: r.active !== false, memo: String(r.memo || '') };
    if (!o.name) throw new Error('이름을 넣어주세요');
    if (i >= 0 && i < rules.length) rules[i] = o; else rules.unshift(o);
    set(K.rules, rules);
  }
  function deleteRule(i) { const rules = get(K.rules, []); rules.splice(i, 1); set(K.rules, rules); }

  function saveFixed(i, f) {
    const list = get(K.fixed, []);
    const o = { name: String(f.name || '').trim().slice(0, 20), keyword: String(f.keyword || '').trim(), amount: Math.max(0, toInt(f.amount)),
      currency: f.currency === 'USD' ? 'USD' : 'KRW', active: f.active !== false, source: f.source === '수입' ? '수입' : '카드' };
    if (!o.name) throw new Error('이름을 넣어주세요');
    if (i >= 0 && i < list.length) list[i] = o; else list.push(o);
    set(K.fixed, list);
  }
  function deleteFixed(i) { const list = get(K.fixed, []); list.splice(i, 1); set(K.fixed, list); }

  function exportJson() {
    return JSON.stringify({ app: 'manna', v: 1, at: now(), data: { rows: get(K.rows, []), raw: get(K.raw, []), cfg: get(K.cfg, {}), fixed: get(K.fixed, []), rules: get(K.rules, []) } });
  }
  function restore(text) {
    const j = JSON.parse(text);
    if (!j || j.app !== 'manna' || !j.data) throw new Error('만나장부 백업 파일이 아니에요');
    set(K.rows, j.data.rows || []); set(K.raw, j.data.raw || []); set(K.cfg, j.data.cfg || {});
    set(K.fixed, j.data.fixed || []); set(K.rules, j.data.rules || []);
    ensure();
  }

  /** 화면에서 부르는 저장 기능 (웹 버전의 Apps Script POST와 같은 모양) */
  function api(b) {
    switch (b.action) {
      case 'reclass': reclass(b.id, b.cls); break;
      case 'edit': edit(b.id, b.amount, b.desc); break;
      case 'fix': fix(b); break;
      case 'config': saveSettings(b.settings || {}); break;
      case 'saveRule': saveRule(b.index, b.rule || {}); break;
      case 'deleteRule': deleteRule(b.index); break;
      case 'saveFixed': saveFixed(b.index, b.fixed || {}); break;
      case 'deleteFixed': deleteFixed(b.index); break;
      default: throw new Error('알 수 없는 요청');
    }
    return { ok: true };
  }

  return { ensure, ingest, drainNative, summary, api, exportJson, restore, refreshFx, _keys: K };
})();
if (typeof module !== 'undefined') module.exports = Local;
