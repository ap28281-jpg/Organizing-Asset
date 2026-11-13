/**
 * 만나장부 — 결제 알림으로 저절로 쓰는 가계부 (Google Apps Script)
 *
 * 처음 쓰는 사람:
 *   시트 위 메뉴 [만나장부] → ① 시작하기 → (권한 허용) → 배포 → 새 배포(웹 앱) → [만나장부] → ② 폰 연결
 *
 * 하는 일
 *  1) MacroDroid가 보내는 카드·은행·페이 알림을 받아서 (doPost)
 *  2) '카드·은행' 시트의 목록대로 해석해서 '거래' 시트에 저장 (할부 분할, 달러 환산, 잔액·누적 대사)
 *  3) 앱이 요청하면 사이클별 카드 결제예정액·생활비 현황을 JSON으로 돌려줌 (doGet)
 *  4) 해석 못 한 알림은 앱에서 직접 고치고, "앞으로 자동 인식"을 누르면 목록에 규칙이 추가됨
 */

var APP_URL = 'https://ap28281-jpg.github.io/Organizing-Asset/';

// ───────────────────────── 메뉴 ─────────────────────────

function onOpen() {
  SpreadsheetApp.getUi().createMenu('만나장부')
    .addItem('① 시작하기', 'setup')
    .addItem('② 폰 연결 (QR)', 'showConnect')
    .addSeparator()
    .addItem('카드·은행 목록 열기', 'openRules')
    .addToUi();
}

function setup() {
  var ss = ss_();
  ensureSheets_();
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TOKEN');
  // 시트를 복사해서 쓰는 경우, 원본 토큰을 물려받지 않도록 새로 만든다
  if (!token || props.getProperty('SHEET_ID') !== ss.getId()) {
    token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    props.setProperty('TOKEN', token);
    props.setProperty('SHEET_ID', ss.getId());
    props.deleteProperty('WEBAPP_URL');
  }
  Logger.log('✅ 준비 완료! 토큰: ' + token);
  try {
    SpreadsheetApp.getUi().alert('✅ 시작 준비 완료!',
      '다음 순서:\n\n1. 확장 프로그램 → Apps Script → 오른쪽 위 [배포] → [새 배포]\n' +
      '2. 유형: 웹 앱 / 실행: 나 / 액세스: 모든 사용자 → [배포]\n' +
      '3. 이 시트로 돌아와서 [만나장부] → ② 폰 연결', SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* 편집기에서 실행한 경우 */ }
}

function openRules() {
  ensureSheets_();
  ss_().setActiveSheet(sheet_(SHEET_RULES));
}

function showConnect() {
  ensureSheets_();
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TOKEN');
  if (!token) { setup(); token = props.getProperty('TOKEN'); }
  var url = props.getProperty('WEBAPP_URL') || '';
  if (!url) {
    try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
    if (!/\/exec$/.test(url)) url = '';
  }
  var t = HtmlService.createTemplate(CONNECT_HTML);
  t.url = url; t.token = token; t.app = APP_URL;
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(420).setHeight(640), '폰 연결');
}

function saveWebAppUrl(url) {
  url = String(url || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) throw new Error('…/exec 로 끝나는 웹 앱 주소를 붙여넣어 주세요');
  PropertiesService.getScriptProperties().setProperty('WEBAPP_URL', url);
  return true;
}

var CONNECT_HTML = [
  '<style>body{font-family:sans-serif;font-size:14px;line-height:1.5;color:#222}h3{margin:14px 0 6px}',
  '.box{border:1px solid #ddd;border-radius:10px;padding:12px;margin-bottom:12px}input{width:100%;padding:8px;box-sizing:border-box}',
  'button{padding:8px 12px;margin-top:6px}code{word-break:break-all;font-size:12px;background:#f4f4f4;padding:4px;display:block}</style>',
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>',
  '<div id="need" style="display:none" class="box"><b>웹 앱 주소가 아직 없어요.</b><br>',
  'Apps Script에서 [배포 → 새 배포 → 웹 앱]을 한 뒤, 나온 주소(…/exec)를 붙여넣어 주세요.',
  '<input id="u" placeholder="https://script.google.com/macros/s/…/exec"><button onclick="save()">저장</button></div>',
  '<div id="ok" style="display:none">',
  '<div class="box"><h3>① 앱 연결</h3>폰 카메라로 찍으면 만나장부가 열리고 <b>자동으로 연결</b>돼요. 열린 화면에서 ⋮ → 앱 설치.',
  '<div id="q1" style="margin:10px 0"></div></div>',
  '<div class="box"><h3>② MacroDroid URL</h3>HTTP 요청의 URL 칸에 이 주소를 넣어요. 폰으로 찍어서 복사해도 돼요.',
  '<div id="q2" style="margin:10px 0"></div><code id="mu"></code></div>',
  '<p style="color:#b4532f;font-size:12px">이 QR과 주소는 내 가계부 열쇠예요. 다른 사람에게 보여주지 마세요.</p></div>',
  '<script>var url=<?!= JSON.stringify(url) ?>,token=<?!= JSON.stringify(token) ?>,app=<?!= JSON.stringify(app) ?>;',
  'function show(){document.getElementById("need").style.display="none";document.getElementById("ok").style.display="block";',
  'var a=app+"#url="+encodeURIComponent(url)+"&token="+token, m=url+"?token="+token;',
  'new QRCode(document.getElementById("q1"),{text:a,width:220,height:220});',
  'new QRCode(document.getElementById("q2"),{text:m,width:180,height:180});document.getElementById("mu").textContent=m;}',
  'function save(){var v=document.getElementById("u").value.trim();google.script.run.withSuccessHandler(function(){url=v;show()})',
  '.withFailureHandler(function(e){alert(e.message)}).saveWebAppUrl(v);}',
  'if(url)show();else document.getElementById("need").style.display="block";</script>'
].join('\n');

// ───────────────────────── 상수 ─────────────────────────
var SHEET_TX = '거래';
var SHEET_RAW = '원문로그';
var SHEET_CFG = '설정';
var SHEET_FIXED = '고정비';
var SHEET_RULES = '카드·은행';

var TX_HEADERS = ['id', '기록시각', '거래시각', '출처', '유형', '내용', '금액', '방향',
  '할부개월', '분류', '통화', '외화금액', '잔액', '카드누적', '청구사이클', '원문', '중복키'];
var RAW_HEADERS = ['수신시각', '앱', '제목', '내용', '상태', 'id'];

var CLASSES = ['생활', '고정', '할부', '이동', '수입', '제외'];
var CARD_TYPES = ['카드승인', '카드취소', '카드누락추정', '카드기록'];
var BANK_TYPES = ['체크결제', '체크취소', '입금', '출금', '잔액차이'];

// 예전 이름과 호환 (처음 만든 버전의 거래 기록이 KB / TOSS 로 저장돼 있음)
var SOURCE_ALIAS = { 'KB국민카드': 'KB', '토스뱅크': 'TOSS' };

var DEFAULT_CONFIG = [
  ['이름', '', '토스 등 이체 상대가 이 이름이면 "이동"(내 계좌끼리)으로 분류'],
  ['수입이름', '월수입', '화면에 보일 수입 이름 (예: 월급, 사례비, 용돈)'],
  ['월수입', 0, '매달 들어오는 수입(원)'],
  ['생활비예산', 400000, '카드 변동지출 + 계좌·페이 입출금 합계 목표(원). 고정비·할부는 제외'],
  ['카드한도', 500000, '신용카드를 한 사이클에 이만큼까지만 쓰기로 한 금액(원). 신용카드를 안 쓰면 0'],
  ['사이클시작일', 1, '카드 이용기간 시작일 (카드사 앱의 "이용기간" 참고. 예: 전월 19일~당월 18일이면 19)'],
  ['결제일', 14, '카드 대금이 빠져나가는 날'],
  ['카드대금부담', '본인', '본인 = 카드 대금을 내 수입에서 뺌 / 그 밖의 글자(예: 부모님) = 빼지 않음'],
  ['수입키워드', '급여|월급|사례비|장학|용돈', '입금 상대에 이 말이 있으면 생활비가 아닌 "수입"으로 분류'],
  ['해외수수료율', 0.015, '달러 결제 예상 원화 계산용 수수료율(대략값)'],
  ['USDKRW', '=GOOGLEFINANCE("CURRENCY:USDKRW")', '실시간 환율(자동). 오류 나면 숫자로 직접 입력해도 됨'],
  ['설정완료', 'N', '앱의 첫 설정을 마치면 Y']
];

// 이름 | 키워드(정규식) | 금액 | 통화 | 결제일(참고) | 사용 | 출처(카드/수입)
var DEFAULT_FIXED = [
  ['예: 통신비', 'KT(?![A-Za-z&])|SKT|SK텔레콤|LG ?U\\+|유플러스|알뜰폰|통신요금', 0, 'KRW', '', 'N', '카드'],
  ['예: 십일조·헌금', '', 0, 'KRW', '', 'N', '수입']
];

// 이름 | 종류 | 알림 앱 | 알아보는 단어 | 사용 | 메모
//  종류: 신용카드 / 체크카드 / 은행·페이 / 은행 문자
//  알림 앱·알아보는 단어는 | 로 여러 개를 이어 쓸 수 있음 (비우면 아무거나)
var DEFAULT_RULES = [
  ['KB국민카드', '신용카드', '메시지', 'KB국민|국민카드', 'Y', '문자 알림'],
  ['신한카드', '신용카드', '메시지', '신한카드', 'Y', ''],
  ['삼성카드', '신용카드', '메시지', '삼성카드|삼성\\d{4}', 'Y', ''],
  ['현대카드', '신용카드', '메시지', '현대카드|현대\\d{4}', 'Y', ''],
  ['롯데카드', '신용카드', '메시지', '롯데카드|롯데\\d{4}', 'Y', ''],
  ['우리카드', '신용카드', '메시지', '우리카드|우리\\(\\d{4}', 'Y', ''],
  ['하나카드', '신용카드', '메시지', '하나카드|하나\\(\\d{4}', 'Y', ''],
  ['NH농협카드', '신용카드', '메시지', '농협|NH카드', 'Y', ''],
  ['BC카드', '신용카드', '메시지', 'BC카드|비씨카드', 'Y', ''],
  ['IBK기업카드', '신용카드', '메시지', 'IBK|기업카드', 'Y', ''],
  ['토스뱅크', '은행·페이', '토스', '', 'Y', '토스 앱 알림 (입출금 알림 켜기)'],
  ['카카오뱅크', '은행·페이', '카카오뱅크', '', 'Y', '카카오뱅크 앱 알림'],
  ['카카오페이', '은행·페이', '카카오페이', '', 'Y', '카카오페이 앱 알림'],
  ['카카오페이(알림톡)', '은행·페이', '카카오톡', '카카오페이', 'N', '카카오톡으로 오면 Y로 바꾸고 MacroDroid에 카카오톡 추가'],
  ['케이뱅크', '은행·페이', '케이뱅크', '', 'Y', ''],
  ['KB스타뱅킹', '은행·페이', '스타뱅킹', '', 'Y', ''],
  ['네이버페이', '은행·페이', '네이버페이|N페이|Npay', '', 'Y', ''],
  ['신한 SOL', '은행·페이', 'SOL', '', 'Y', ''],
  ['우리WON', '은행·페이', 'WON', '', 'Y', ''],
  ['하나원큐', '은행·페이', '하나원큐|하나은행', '', 'Y', ''],
  ['NH농협', '은행·페이', '올원|NH스마트|농협', '', 'Y', ''],
  ['은행 문자(입출금)', '은행 문자', '메시지', '입금|출금', 'Y', '은행 입출금 문자 (잔액 맞추기 없음)']
];

// ─────────────────── 순수 함수 (테스트 가능) ───────────────────

function toInt(s) {
  if (s === null || s === undefined || s === '') return 0;
  if (typeof s === 'number') return Math.round(s);
  var n = parseInt(String(s).replace(/[^\d-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function parseDt(s) {
  var m = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0) };
}

function fmtDt(o) {
  return o.y + '-' + pad2(o.m) + '-' + pad2(o.d) + ' ' + pad2(o.h) + ':' + pad2(o.mi);
}

function dtNum(s) {
  var o = parseDt(s);
  if (!o) return 0;
  return ((((o.y * 100 + o.m) * 100 + o.d) * 100 + o.h) * 100 + o.mi);
}

function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

/** 문자에는 연도가 없으니 '지금' 기준으로 연도 추정 */
function inferDateTime(mo, d, h, mi, now) {
  var n = parseDt(now);
  var cand = { y: n.y, m: mo, d: d, h: h, mi: mi };
  var future = new Date(n.y, mo - 1, d) - new Date(n.y, n.m - 1, n.d);
  if (future > 3 * 86400000) cand.y = n.y - 1;
  return fmtDt(cand);
}

/** 거래시각 → 사이클 키 'YYYY-MM' (그 달 시작일부터) */
function cycleKeyOf(dt, startDay) {
  startDay = startDay || 1;
  var o = parseDt(dt);
  var y = o.y, m = o.m;
  if (o.d < startDay) { m -= 1; if (m === 0) { m = 12; y -= 1; } }
  return y + '-' + pad2(m);
}

function addMonthsKey(key, n) {
  var y = +key.slice(0, 4), m = +key.slice(5, 7) + n;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return y + '-' + pad2(m);
}

function monthsDiff(a, b) {
  return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
}

/** 사이클 정보: 이용기간과 결제일 (결제일은 이용기간이 끝난 뒤 처음 오는 그날) */
function cycleInfo(key, startDay, payDay) {
  startDay = startDay || 1; payDay = payDay || 14;
  var y = +key.slice(0, 4), m = +key.slice(5, 7);
  var endKey, endDay;
  if (startDay === 1) { endKey = key; endDay = daysInMonth(y, m); }
  else { endKey = addMonthsKey(key, 1); endDay = startDay - 1; }
  var payKey = payDay > endDay ? endKey : addMonthsKey(endKey, 1);
  return {
    key: key,
    start: y + '-' + pad2(m) + '-' + pad2(startDay),
    end: endKey + '-' + pad2(endDay),
    payDate: payKey + '-' + pad2(payDay),
    label: m + '/' + startDay + ' ~ ' + (+endKey.slice(5, 7)) + '/' + endDay,
    payLabel: (+payKey.slice(5, 7)) + '/' + payDay + ' 결제'
  };
}

function splitInstallment(total, n) {
  if (!n || n <= 1) return [total];
  var base = Math.floor(total / n), parts = [];
  for (var i = 0; i < n; i++) parts.push(base);
  parts[0] += total - base * n;
  return parts;
}

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/^[\s|·:\-\[\]]+|[\s|·:\-]+$/g, '').trim();
}

function escapeRe(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function isCardType(t) { return CARD_TYPES.indexOf(t) >= 0; }
function isBankType(t) { return BANK_TYPES.indexOf(t) >= 0; }

function aliasSource(name) { return SOURCE_ALIAS[name] || name; }

function safeRe(src, flags) {
  try { return new RegExp(src, flags || 'i'); } catch (e) { return new RegExp(escapeRe(src), flags || 'i'); }
}

/** 이 규칙이 이 알림에 해당하는가 */
function ruleMatches(rule, app, blob) {
  if (!rule.active) return false;
  if (rule.app && !safeRe(rule.app).test(app)) return false;
  if (rule.word && !safeRe(rule.word).test(blob)) return false;
  return true;
}

function rulesFromRows(vals) {
  var out = [];
  (vals || []).forEach(function (v) {
    if (!v[0]) return;
    out.push({ name: String(v[0]).trim(), kind: String(v[1] || '은행·페이').trim(),
      app: String(v[2] || '').trim(), word: String(v[3] || '').trim(),
      active: String(v[4] || 'Y').trim().toUpperCase() !== 'N' });
  });
  return out;
}

function fixedFromRows(vals) {
  var out = [];
  (vals || []).forEach(function (v) {
    if (!v[0]) return;
    var src = String(v[6] || '카드').trim();
    out.push({ name: String(v[0]), keyword: String(v[1] || ''), amount: Number(v[2]) || 0,
      currency: String(v[3] || 'KRW').toUpperCase(), day: Number(v[4]) || null,
      active: String(v[5] || 'Y').toUpperCase() !== 'N',
      source: (src === '사례비' || src === '수입') ? '수입' : '카드' });
  });
  return out;
}

var AD_WORDS = /(최대|이벤트|혜택|쿠폰|추첨|\(광고\)|광고|할인|드려요|받아가세요|참여하|친구 ?초대|당첨|적립 예정|프로모션)/;

function extractCardMerchant(t, flat, word) {
  var wordRe = word ? safeRe(word) : null;
  var skip = /(Web발신|고객명|승인시각|누적|잔액|한도|이용가능|님$|^\d{1,2}\/\d{1,2}|^\d{1,2}월\s*\d{1,2}일|^(승인|취소|승인취소|해외승인|체크승인)$|^(USD|US\$)|\d\.\d{2}\s*(USD|달러)$|^[\d,]+\s*원\s*\(?(일시불|\d+\s*개월(\s*할부)?)?\)?$|카드\s*\(?\d{4}\)?\s*(승인|취소)?$|^\(?\d{4}\)?$|한 ?달)/;
  var lines = t.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  if (lines.length >= 3) {
    var cand = lines.filter(function (l) { return !skip.test(l) && !(wordRe && wordRe.test(l) && /(승인|취소|\d{4})/.test(l)); });
    if (cand.length) return cleanText(cand[0]);
  }
  var m = flat.match(/원\s*\(?(?:일시불|\d+\s*개월(?:\s*할부)?)\)?\s*(?!\)|\d{1,2}[\/월])(.+?)\s*(?:고객명|승인시각|\S+님(?:\s|$)|\d{1,2}\/\d{1,2}\s+\d|누적|잔액|한 ?달|$)/);
  if (m && cleanText(m[1])) return cleanText(m[1]);
  var m2 = flat.match(/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s+(.+?)(?:\s+(?:누적|잔액)|$)/);
  if (m2 && cleanText(m2[1])) return cleanText(m2[1]);
  return '(이름 미상)';
}

/**
 * 카드 문자/알림 해석 (카드사 상관없이)
 *  rule: {name, kind, word} — kind가 체크카드이거나 본문에 '체크'가 있으면 체크카드로 처리
 */
function parseCardMsg(raw, now, rule) {
  rule = rule || { name: '카드', kind: '신용카드', word: '' };
  var t = String(raw || '').replace(/\r/g, '');
  if (!/(승인|취소|결제|사용)/.test(t)) return null;
  var flat = t.replace(/\s+/g, ' ').trim();
  var isCancel = /취소/.test(flat);
  var isCheck = rule.kind === '체크카드' || /체크/.test(flat);

  var cardM = flat.match(/(\d{4})\)?\s*(?:승인|취소|결제|사용)/) || flat.match(/카드\s*\(?(\d{4})/);
  var cumM = flat.match(/누적\s*:?\s*(-?[\d,]+)\s*원/);
  var balM = flat.match(/잔액\s*:?\s*(-?[\d,]+)\s*원/);
  var body = flat.replace(/(누적|잔액|한도|이용가능(?:한도)?)\s*:?\s*-?[\d,]+\s*원/g, ' ');

  var currency = 'KRW', fx = null;
  var usdM = body.match(/(?:USD|US\$)\s*([\d,]+(?:\.\d+)?)/i) ||
             body.match(/([\d,]+\.\d{1,2})\s*(?:USD|달러|\$)/i);
  if (usdM) { currency = 'USD'; fx = parseFloat(usdM[1].replace(/,/g, '')); }

  var amtM = body.match(/(\d[\d,]*)\s*원/);
  if (!amtM && !usdM) return null;
  var amount = amtM ? toInt(amtM[1]) : 0;
  if (!amount && !fx) return null;

  var monM = body.match(/(\d{1,2})\s*개월/);
  var months = monM ? parseInt(monM[1], 10) : 1;

  var tm = body.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/) ||
           body.match(/(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2}):(\d{2})/);
  var time = tm ? inferDateTime(+tm[1], +tm[2], +tm[3], +tm[4], now) : now;

  var p = {
    source: aliasSource(rule.name), card: cardM ? cardM[1] : '',
    amount: amount, dir: isCancel ? 1 : -1, months: isCheck ? 1 : months,
    desc: extractCardMerchant(t, flat, rule.word), time: time,
    cumulative: cumM ? toInt(cumM[1]) : null, currency: currency, fx: fx, balance: null
  };
  if (isCheck) { p.type = isCancel ? '체크취소' : '체크결제'; p.balance = balM ? toInt(balM[1]) : null; }
  else p.type = isCancel ? '카드취소' : '카드승인';
  return p;
}

/** 묶여서 온 카드 문자 여러 건 나누기 */
function parseCardAll(raw, now, rule) {
  var t = String(raw || ''), out = [];
  var parts = t.split(/\n(?=\[Web발신\]|\S*카드\s*\(?\d{4})/);
  if (parts.length > 1) {
    parts.forEach(function (chunk) {
      if (!/(승인|취소)/.test(chunk)) return;
      var p = parseCardMsg(chunk, now, rule);
      if (p) out.push(p);
    });
  }
  if (!out.length) { var one = parseCardMsg(t, now, rule); if (one) out.push(one); }
  return out;
}

/** 은행·페이 알림 해석 (토스, 카카오뱅크, 카카오페이, 케이뱅크 …) */
function parseBankMsg(title, text, now, rule) {
  rule = rule || { name: '계좌', kind: '은행·페이' };
  var full = String(title || '') + '\n' + String(text || '');
  var flat = full.replace(/\s+/g, ' ').trim();
  var balM = flat.match(/잔액\s*:?\s*(-?[\d,]+)\s*원/);
  if (!balM && AD_WORDS.test(flat)) return null;

  var body = flat.replace(/잔액\s*:?\s*-?[\d,]+\s*원/g, ' ');
  var amtM = body.match(/(\d[\d,]*)\s*원/);
  if (!amtM) return null;
  var amount = toInt(amtM[1]);
  if (!amount) return null;

  var type, dir;
  if (/(결제\s*취소|승인\s*취소|환불|취소)/.test(body)) { type = '체크취소'; dir = 1; }
  else if (/(결제|승인|사용)/.test(body)) { type = '체크결제'; dir = -1; }
  else if (/(입금|받았|들어왔|받기 완료)/.test(body)) { type = '입금'; dir = 1; }
  else if (/(출금|이체|송금|보냈|빠져|자동이체|인출|납부)/.test(body)) { type = '출금'; dir = -1; }
  else return null;
  if (!balM && !/(체크|카드|결제|입금|출금|이체|송금|보냈|받았|승인|환불|취소|납부|인출)/.test(body)) return null;

  var desc = '';
  var textFlat = String(text || '').replace(/잔액\s*:?\s*-?[\d,]+\s*원/g, ' ');
  var pipe = textFlat.match(/\|\s*([^\n|]+)/);
  if (pipe) desc = cleanText(pipe[1]);
  if (!desc) {
    var nameM = textFlat.match(/([^\s\n]{2,20})\s*님(?:이|에게|께|으로부터|한테)/);
    if (nameM) desc = cleanText(nameM[1]);
  }
  if (!desc) {
    desc = cleanText(textFlat.replace(/\s+/g, ' ')
      .replace(safeRe(escapeRe(rule.name), 'g'), ' ')
      .replace(/\[Web발신\]|\[[^\]]{1,6}\]/g, ' ')
      .replace(/\d{1,2}\/\d{1,2}\s*\d{1,2}:\d{2}|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}/g, ' ')
      .replace(/\d{2,6}\*+[\d*]*/g, ' ')
      .replace(/토스뱅크|카카오뱅크|카카오페이|케이뱅크|네이버페이|체크카드|토스|은행|신한|국민|KB|우리|농협|NH|IBK|기업/g, ' ')
      .replace(/(\d[\d,]*)\s*원/, ' ')
      .replace(/(결제\s*취소|결제|입금|출금|이체|송금|승인|되었어요|했어요|됐어요|받았어요|보냈어요|완료|알림|\[Web발신\])/g, ' '));
  }
  return {
    source: aliasSource(rule.name), type: type, amount: amount, dir: dir, months: 1,
    desc: (desc || (dir > 0 ? '입금' : '출금')).slice(0, 40),
    time: now, balance: balM ? toInt(balM[1]) : null, currency: 'KRW', fx: null,
    noBalanceCheck: rule.kind === '은행 문자'
  };
}

/** 예전 이름 유지 (테스트 호환) */
function parseKB(raw, now) { return parseCardMsg(raw, now, { name: 'KB국민카드', kind: '신용카드', word: 'KB국민|국민카드' }); }
function parseKBAll(raw, now) { return parseCardAll(raw, now, { name: 'KB국민카드', kind: '신용카드', word: 'KB국민|국민카드' }); }
function parseToss(title, text, now) { return parseBankMsg(title, text, now, { name: '토스뱅크', kind: '은행·페이' }); }

/** 규칙 하나로 알림 해석 */
function parseWithRule(rule, title, text, now) {
  var blob = String(title || '') + '\n' + String(text || '');
  if (rule.kind === '신용카드' || rule.kind === '체크카드') return parseCardAll(blob, now, rule);
  var p = parseBankMsg(title, text, now, rule);
  return p ? [p] : [];
}

/** 알림 하나를 규칙 목록으로 해석: 맞는 규칙을 위에서부터 차례로 시도 */
function parseNotification(rules, app, title, text, now) {
  var blob = String(title || '') + '\n' + String(text || '');
  var matched = rules.filter(function (r) { return ruleMatches(r, app, blob); });
  for (var i = 0; i < matched.length; i++) {
    var list = parseWithRule(matched[i], title, text, now);
    if (list.length) return { list: list, rule: matched[i], matched: true };
  }
  return { list: [], rule: null, matched: matched.length > 0 };
}

/** 해석 못 했어도 사용자에게 보여줄 만한 돈 알림인가 */
function looksLikeMoney(blob) {
  var f = String(blob || '').replace(/\s+/g, ' ');
  if (AD_WORDS.test(f) && !/잔액/.test(f)) return false;
  return /\d[\d,]*\s*원|USD/.test(f) && /(승인|취소|입금|출금|결제|이체|송금|사용|보냈|받았)/.test(f);
}

function amountsIn(blob) {
  var out = [], re = /(\d[\d,]*)\s*원/g, m;
  var f = String(blob || '');
  while ((m = re.exec(f))) { var n = toInt(m[1]); if (n && out.indexOf(n) < 0) out.push(n); }
  return out.slice(0, 6);
}

/** 자동 분류 */
function classify(p, fixedList, selfName, incomeKeyword) {
  if (isCardType(p.type)) {
    if (p.months > 1) return '할부';
    for (var i = 0; i < fixedList.length; i++) {
      var f = fixedList[i];
      if (f.source === '수입') continue;
      if (f.active && f.keyword && safeRe(f.keyword).test(p.desc)) return '고정';
    }
    return '생활';
  }
  if (selfName && p.type !== '체크결제' && p.type !== '체크취소' &&
      String(p.desc).indexOf(selfName) >= 0) return '이동';
  if (p.dir === 1 && p.type === '입금' && incomeKeyword && safeRe(incomeKeyword).test(p.desc)) return '수입';
  if (p.dir === -1) {
    for (var j = 0; j < fixedList.length; j++) {
      var g = fixedList[j];
      if (g.active && g.keyword && safeRe(g.keyword).test(p.desc)) return '고정';
    }
  }
  return '생활';
}

/** 같은 거래인지 판별하는 고유 키 (영구 중복 방지) */
function dedupKey(p) {
  if (isCardType(p.type)) {
    return [p.source, p.type, p.time, p.amount, p.fx || '', p.cumulative === null || p.cumulative === undefined ? '' : p.cumulative].join('|');
  }
  if (p.balance !== null && p.balance !== undefined) return [p.source, p.type, p.amount, p.balance].join('|');
  return '';
}

function kbCumGap(prevCum, p) {
  if (prevCum === null || prevCum === undefined || p.cumulative === null || p.cumulative === undefined) return 0;
  return p.cumulative - (prevCum + (p.dir === -1 ? p.amount : -p.amount));
}

function daysBetween(a, b) {
  var x = parseDt(a), y = parseDt(b);
  return Math.abs(new Date(y.y, y.m - 1, y.d, y.h, y.mi) - new Date(x.y, x.m - 1, x.d, x.h, x.mi)) / 86400000;
}

/** 잔액 대사 (알림 순서가 뒤바뀌어도 견디게) */
function decideToss(recent, p, openGaps) {
  if (p.balance === null || p.balance === undefined || !recent.length) return { gap: 0, resolveId: null };
  var pred = p.balance - p.dir * p.amount;
  for (var i = recent.length - 1; i >= 0; i--) {
    if (recent[i].balance === pred) {
      var resolveId = null;
      if (i < recent.length - 1) {
        for (var j = 0; j < openGaps.length; j++) {
          if (openGaps[j].amount === p.amount && openGaps[j].dir === p.dir) { resolveId = openGaps[j].id; break; }
        }
      }
      return { gap: 0, resolveId: resolveId };
    }
  }
  var last = recent[recent.length - 1];
  return { gap: p.balance - (last.balance + p.dir * p.amount), resolveId: null };
}

function balanceGap(prevBalance, p) {
  if (prevBalance === null || prevBalance === undefined || p.balance === null) return 0;
  return p.balance - (prevBalance + p.dir * p.amount);
}

function rowCycle(r, startDay) { return r.cycle || cycleKeyOf(r.time, startDay); }

/** 사이클 K에서 이 행이 카드 청구액에 더하는 금액 (지출 +) */
function cardShare(r, K, startDay) {
  if (r.cls === '제외' || r.type === '카드기록') return 0; // 카드기록 = 기준값에 이미 포함된 과거 내역
  if (isCardType(r.type)) {
    var c0 = rowCycle(r, startDay), spend = -r.dir * r.amount;
    if (r.months <= 1) return c0 === K ? spend : 0;
    var parts = splitInstallment(r.amount, r.months), idx = monthsDiff(c0, K);
    return (idx >= 0 && idx < r.months) ? -r.dir * parts[idx] : 0;
  }
  if (r.source === '수동' && (r.type === '기준값' || r.type === '할부예약')) return r.cycle === K ? r.amount : 0;
  return 0;
}

function convertUsd(usd, fxRate, feeRate) { return Math.round(usd * fxRate * (1 + (feeRate || 0))); }

/** 전체 요약 계산 (앱이 보는 JSON) */
function computeSummary(rows, fixedList, cfg, now, focusKey) {
  var sd = Number(cfg['사이클시작일']) || 1, pd = Number(cfg['결제일']) || 14;
  var nowKey = cycleKeyOf(now, sd);
  var K = focusKey || nowKey;
  var nextK = addMonthsKey(K, 1), prevK = addMonthsKey(K, -1);
  var fxRate = Number(cfg['USDKRW']) || 0, fee = Number(cfg['해외수수료율']) || 0;
  var cardLimit = cfg['카드한도'] === '' || cfg['카드한도'] === undefined ? 500000 : Number(cfg['카드한도']);

  function cardBlock(key) {
    var items = [], confirmed = 0, hasBaseline = false;
    rows.forEach(function (r) {
      var v = cardShare(r, key, sd);
      if (r.source === '수동' && r.type === '기준값' && r.cycle === key) hasBaseline = true;
      if (v !== 0) {
        confirmed += v;
        items.push({ id: r.id, desc: r.desc, amount: v, cls: r.cls, type: r.type,
          installment: r.months > 1 ? (monthsDiff(rowCycle(r, sd), key) + 1) + '/' + r.months : '' });
      }
    });
    var pending = [];
    if (!hasBaseline) {
      fixedList.forEach(function (f) {
        if (!f.active || f.source === '수입' || !f.amount) return;
        var re = safeRe(f.keyword || '^$');
        var charged = rows.some(function (r) {
          return isCardType(r.type) && r.cls === '고정' && rowCycle(r, sd) === key && re.test(r.desc);
        });
        if (!charged) {
          var amt = f.currency === 'USD' ? convertUsd(f.amount, fxRate, fee) : f.amount;
          pending.push({ name: f.name, amount: amt, currency: f.currency, fx: f.currency === 'USD' ? f.amount : null });
        }
      });
    }
    var pendingSum = pending.reduce(function (a, b) { return a + b.amount; }, 0);
    return { confirmed: confirmed, pending: pending, pendingSum: pendingSum,
      expected: confirmed + pendingSum, limit: cardLimit, items: items, hasBaseline: hasBaseline };
  }

  function livingBlock(key) {
    var spent = 0, income = 0, card = 0, bank = 0, gaps = 0, bankIncome = 0;
    rows.forEach(function (r) {
      if (r.cls !== '생활') return;
      var c = isCardType(r.type), b = isBankType(r.type);
      if (!c && !b) return;
      if (rowCycle(r, sd) !== key) return;
      var v = -r.dir * r.amount;
      if (v > 0) { spent += v; if (c) card += v; else bank += v; }
      else { income += -v; if (b) bankIncome += -v; }
      if (r.type === '잔액차이' || r.type === '카드누락추정') gaps += 1;
    });
    var budget = Number(cfg['생활비예산']) || 400000, net = spent - income;
    return { budget: budget, spent: spent, income: income, net: net, remaining: budget - net,
      card: card, bank: bank, bankIncome: bankIncome, toss: bank, tossIncome: bankIncome, gapCount: gaps };
  }

  var installments = [];
  rows.forEach(function (r) {
    if (r.cls === '제외') return;
    if (isCardType(r.type) && r.months > 1 && r.dir === -1) {
      var c0 = rowCycle(r, sd), parts = splitInstallment(r.amount, r.months);
      var idx = monthsDiff(c0, nowKey), left = r.months - Math.max(idx, 0);
      if (left > 0) installments.push({ desc: r.desc, monthly: parts[parts.length - 1],
        total: r.amount, months: r.months, left: left,
        lastCycle: cycleInfo(addMonthsKey(c0, r.months - 1), sd, pd).payLabel });
    }
    if (r.source === '수동' && r.type === '할부예약' && monthsDiff(nowKey, r.cycle) >= 0) {
      installments.push({ desc: r.desc, monthly: r.amount, total: null, months: null, left: 1,
        lastCycle: cycleInfo(r.cycle, sd, pd).payLabel });
    }
  });

  var balMap = {}, lastCum = null;
  rows.forEach(function (r) {
    if (isBankType(r.type) && r.balance !== null && r.balance !== undefined && r.balance !== '') {
      if (!balMap[r.source] || dtNum(r.time) >= dtNum(balMap[r.source].time)) balMap[r.source] = { source: r.source, balance: r.balance, time: r.time };
    }
    if (isCardType(r.type) && r.cumulative) {
      if (!lastCum || dtNum(r.time) >= dtNum(lastCum.time)) lastCum = { cumulative: r.cumulative, time: r.time, source: r.source };
    }
  });
  var balances = Object.keys(balMap).map(function (k) { return balMap[k]; });

  var shownKeys = [K, prevK];
  var tx = rows.filter(function (r) {
    return r.type !== '잔액기준' && shownKeys.indexOf(rowCycle(r, sd)) >= 0;
  }).sort(function (a, b) { return dtNum(b.time) - dtNum(a.time); }).map(function (r) {
    return { id: r.id, time: r.time, source: r.source, type: r.type, desc: r.desc,
      amount: r.amount, dir: r.dir, months: r.months, cls: r.cls, currency: r.currency,
      fx: r.fx, balance: r.balance, cycle: rowCycle(r, sd), card: isCardType(r.type) };
  });

  var info = cycleInfo(K, sd, pd);
  var endO = parseDt(info.end + ' 23:59'), nowO = parseDt(now);
  var daysLeft = Math.round((new Date(endO.y, endO.m - 1, endO.d) - new Date(nowO.y, nowO.m - 1, nowO.d)) / 86400000);

  // 수입 한 달 흐름: 수입 − 수입에서 나가는 고정지출 − (본인 부담이면) 카드 고정비 = 생활에 쓸 수 있는 내 돈
  var income = Number(cfg['월수입']) || 0;
  var salaryFixed = fixedList.filter(function (f) { return f.active && f.source === '수입' && f.amount; })
    .map(function (f) { return { name: f.name, amount: f.currency === 'USD' ? convertUsd(f.amount, fxRate, fee) : f.amount }; });
  var salaryFixedSum = salaryFixed.reduce(function (a, b) { return a + b.amount; }, 0);
  var payer = String(cfg['카드대금부담'] || '본인').trim();
  var parentPays = payer !== '본인';
  function planFor(card, living) {
    var cardLiving = Math.max(living.card, 0);
    var cardFixed = Math.max(card.expected - cardLiving, 0);
    var mine = income - salaryFixedSum - (parentPays ? 0 : cardFixed);
    var tossNet = living.bank - living.bankIncome;
    var myRemaining = mine - tossNet - (parentPays ? 0 : cardLiving);
    return { income: income, salaryFixedSum: salaryFixedSum, parentPays: parentPays, payer: payer,
      cardTotal: card.expected, cardLimit: card.limit, cardFixed: cardFixed, cardRoom: card.limit - card.expected,
      mine: mine, tossNet: tossNet, myRemaining: myRemaining, budget: living.budget, livingNet: living.net };
  }
  var curCard = cardBlock(K), curLiving = livingBlock(K);
  var nextCard = cardBlock(nextK), nextLiving = livingBlock(nextK);

  return {
    now: now, nowKey: nowKey, focusKey: K, isCurrent: K === nowKey,
    cycle: info, daysLeft: daysLeft,
    card: curCard, living: curLiving,
    next: { cycle: cycleInfo(nextK, sd, pd), card: nextCard, plan: planFor(nextCard, nextLiving) },
    plan: planFor(curCard, curLiving), salaryFixed: salaryFixed,
    installments: installments,
    balances: balances, tossBalance: balMap['TOSS'] || balances[0] || null, kbCumulative: lastCum,
    fx: { usdkrw: fxRate, fee: fee },
    settings: {
      이름: cfg['이름'] || '', 수입이름: cfg['수입이름'] || '월수입', 월수입: income,
      생활비예산: Number(cfg['생활비예산']) || 0, 카드한도: cardLimit, 사이클시작일: sd, 결제일: pd,
      카드대금부담: payer, 설정완료: String(cfg['설정완료'] || 'N').toUpperCase() === 'Y'
    },
    transactions: tx
  };
}

// ─────────────────── Apps Script 연동부 ───────────────────

function nowKST() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'); }
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name) { return ss_().getSheetByName(name); }

/** 필요한 시트·설정·헤더가 없으면 만든다 (예전 버전 시트도 자동으로 맞춰줌) */
function ensureSheets_() {
  var ss = ss_();
  var tx = sheet_(SHEET_TX);
  if (!tx) { tx = ss.insertSheet(SHEET_TX); tx.getRange('A:Q').setNumberFormat('@'); tx.appendRow(TX_HEADERS); tx.setFrozenRows(1); }
  else if (tx.getLastRow() === 0) { tx.getRange('A:Q').setNumberFormat('@'); tx.appendRow(TX_HEADERS); tx.setFrozenRows(1); }
  else if (tx.getRange(1, 17).getValue() !== '중복키') tx.getRange(1, 17).setValue('중복키');

  var raw = sheet_(SHEET_RAW);
  if (!raw) { raw = ss.insertSheet(SHEET_RAW); raw.getRange('A:F').setNumberFormat('@'); raw.appendRow(RAW_HEADERS); raw.setFrozenRows(1); }
  else if (raw.getLastRow() === 0) { raw.getRange('A:F').setNumberFormat('@'); raw.appendRow(RAW_HEADERS); raw.setFrozenRows(1); }
  else if (raw.getRange(1, 5).getValue() !== '상태') raw.getRange(1, 5, 1, 2).setValues([['상태', 'id']]);

  var cfg = sheet_(SHEET_CFG);
  if (!cfg) { cfg = ss.insertSheet(SHEET_CFG); cfg.appendRow(['항목', '값', '설명']); cfg.setFrozenRows(1); }
  var have = {};
  cfg.getDataRange().getValues().forEach(function (r) { have[r[0]] = true; });
  var oldUser = tx.getLastRow() > 1;
  DEFAULT_CONFIG.forEach(function (r) {
    if (have[r[0]]) return;
    var row = r.slice();
    if (oldUser && r[0] === '설정완료') row[1] = 'Y';          // 이미 쓰던 사람은 설정 마법사 건너뜀
    if (oldUser && r[0] === '수입이름' && have['월수입']) row[1] = '사례비';
    if (r[0] === '이름' && have['내이름']) row[1] = cfg.getDataRange().getValues().filter(function (x) { return x[0] === '내이름'; })[0][1];
    cfg.appendRow(row);
  });

  var fx = sheet_(SHEET_FIXED);
  if (!fx) {
    fx = ss.insertSheet(SHEET_FIXED);
    fx.appendRow(['이름', '키워드(정규식)', '금액', '통화(KRW/USD)', '결제일(참고)', '사용(Y/N)', '출처(카드/수입)']);
    DEFAULT_FIXED.forEach(function (r) { fx.appendRow(r); });
    fx.setFrozenRows(1);
  }

  var rules = sheet_(SHEET_RULES);
  if (!rules) {
    rules = ss.insertSheet(SHEET_RULES);
    rules.appendRow(['이름', '종류(신용카드/체크카드/은행·페이/은행 문자)', '알림 앱(비우면 아무 앱)', '알아보는 단어(비우면 아무 말)', '사용(Y/N)', '메모']);
    DEFAULT_RULES.forEach(function (r) { rules.appendRow(r); });
    rules.setFrozenRows(1);
    rules.getRange('A:F').setNumberFormat('@');
  }
}

function readConfig_() {
  var vals = sheet_(SHEET_CFG).getDataRange().getValues(), cfg = {};
  for (var i = 1; i < vals.length; i++) {
    var k = vals[i][0], v = vals[i][1];
    if (!k) continue;
    cfg[k] = (typeof v === 'string' && /^-?[\d.]+$/.test(v)) ? Number(v) : v;
  }
  if (!cfg['이름'] && cfg['내이름']) cfg['이름'] = cfg['내이름'];
  if (!(Number(cfg['USDKRW']) > 0)) cfg['USDKRW'] = fetchUsdKrw_();
  return cfg;
}

function writeConfig_(pairs) {
  var sh = sheet_(SHEET_CFG), vals = sh.getDataRange().getValues();
  Object.keys(pairs).forEach(function (k) {
    for (var i = 1; i < vals.length; i++) {
      if (vals[i][0] === k) { sh.getRange(i + 1, 2).setValue(pairs[k]); return; }
    }
    sh.appendRow([k, pairs[k], '']);
  });
}

function fetchUsdKrw_() {
  var cache = CacheService.getScriptCache(), c = cache.get('usdkrw');
  if (c) return Number(c);
  try {
    var res = UrlFetchApp.fetch('https://open.er-api.com/v6/latest/USD', { muteHttpExceptions: true });
    var rate = JSON.parse(res.getContentText()).rates.KRW;
    if (rate) { cache.put('usdkrw', String(rate), 3600); return rate; }
  } catch (e) { }
  return 0;
}

function readFixed_() { return fixedFromRows(sheet_(SHEET_FIXED).getDataRange().getValues().slice(1)); }
function readRules_() { return rulesFromRows(sheet_(SHEET_RULES).getDataRange().getValues().slice(1)); }

function str_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  return v === null || v === undefined ? '' : String(v);
}

function readRows_() {
  var vals = sheet_(SHEET_TX).getDataRange().getValues(), rows = [];
  for (var i = 1; i < vals.length; i++) {
    var v = vals[i];
    if (!v[0]) continue;
    rows.push({
      id: str_(v[0]), recordedAt: str_(v[1]), time: str_(v[2]), source: str_(v[3]),
      type: str_(v[4]), desc: str_(v[5]), amount: toInt(v[6]), dir: toInt(v[7]),
      months: toInt(v[8]) || 1, cls: str_(v[9]) || '생활', currency: str_(v[10]) || 'KRW',
      fx: v[11] === '' ? null : Number(v[11]), balance: v[12] === '' ? null : toInt(v[12]),
      cumulative: v[13] === '' ? null : toInt(v[13]), cycle: str_(v[14]), raw: str_(v[15]), key: str_(v[16]), _row: i + 1
    });
  }
  return rows;
}

function newId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 10); }

function appendTx_(o) {
  var row = [o.id || newId_(), nowKST(), o.time, o.source, o.type, o.desc, o.amount, o.dir,
    o.months || 1, o.cls, o.currency || 'KRW', o.fx === null || o.fx === undefined ? '' : o.fx,
    o.balance === null || o.balance === undefined ? '' : o.balance,
    o.cumulative === null || o.cumulative === undefined ? '' : o.cumulative,
    o.cycle || '', o.raw || '', o.key || ''];
  sheet_(SHEET_TX).appendRow(row.map(function (x) { return x === '' ? '' : String(x); }));
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function getPayload_(e) {
  var p = {};
  if (e && e.parameter) for (var k in e.parameter) p[k] = e.parameter[k];
  if (e && e.postData && e.postData.contents) {
    try { var j = JSON.parse(e.postData.contents); for (var k2 in j) p[k2] = j[k2]; } catch (err) { }
  }
  return p;
}

function checkToken_(p) {
  var t = PropertiesService.getScriptProperties().getProperty('TOKEN');
  return t && p.token === t;
}

function ensureOnce_() {
  var c = CacheService.getScriptCache();
  if (c.get('ensured2')) return;
  ensureSheets_();
  c.put('ensured2', '1', 21600);
}

function bumpSummary_() { CacheService.getScriptCache().put('sumver', String(Date.now()), 21600); }

function readUnparsed_() {
  var sh = sheet_(SHEET_RAW); if (!sh) return [];
  var vals = sh.getDataRange().getValues(), out = [];
  for (var i = vals.length - 1; i >= 1 && out.length < 20; i--) {
    var v = vals[i];
    if (str_(v[4]) !== '미해석') continue;
    out.push({ id: str_(v[5]), time: str_(v[0]), app: str_(v[1]), title: str_(v[2]), text: str_(v[3]),
      amounts: amountsIn(str_(v[2]) + ' ' + str_(v[3])) });
  }
  return out;
}

function doGet(e) {
  var p = getPayload_(e);
  if (!checkToken_(p)) return json_({ ok: false, error: '토큰이 맞지 않아요' });
  var cache = CacheService.getScriptCache();
  var ck = 'sum|' + (cache.get('sumver') || '0') + '|' + (p.cycle || 'now');
  var hit = cache.get(ck);
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  ensureOnce_();
  var cfg = readConfig_();
  var data = computeSummary(readRows_(), readFixed_(), cfg, nowKST(), p.cycle || null);
  data.unparsed = readUnparsed_();
  var out = JSON.stringify({ ok: true, data: data });
  try { cache.put(ck, out, 60); } catch (err) { }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var p = getPayload_(e);
  if (!checkToken_(p)) return json_({ ok: false, error: '토큰이 맞지 않아요' });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensureOnce_();
    var r;
    if (p.action === 'reclass') r = reclass_(p.id, p.cls);
    else if (p.action === 'edit') r = editTx_(p.id, p.amount, p.desc);
    else if (p.action === 'fix') r = fixRaw_(p);
    else if (p.action === 'config') r = saveSettings_(p.settings || {});
    else r = ingest_(String(p.app || ''), String(p.title || ''), String(p.text || ''));
    bumpSummary_();
    return json_(r);
  } finally {
    lock.releaseLock();
  }
}

function logRaw_(now, app, title, text, status) {
  var id = newId_();
  sheet_(SHEET_RAW).appendRow([now, app, title, text, status, id]);
  return id;
}

function ingest_(app, title, text) {
  var now = nowKST();
  var cache = CacheService.getScriptCache();
  var hkey = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, app + '|' + title + '|' + text));
  if (cache.get(hkey)) return { ok: true, duplicate: true };
  cache.put(hkey, '1', 900);

  var blob = title + '\n' + text;
  var res = parseNotification(readRules_(), app, title, text, now);
  if (!res.list.length) {
    // 돈 알림처럼 보이면 "놓친 알림"으로 남기고, 아니면(광고·대화 등) 기록하지 않음
    // 카카오톡 같은 대화 앱은 규칙에 맞을 때만 남긴다 (개인 대화가 기록되지 않도록)
    if (looksLikeMoney(blob) && (res.matched || !/카카오톡|kakaotalk/i.test(app))) logRaw_(now, app, title, text, '미해석');
    return { ok: true, parsed: false };
  }
  logRaw_(now, app, title, text, '해석됨');

  var cfg = readConfig_(), fixed = readFixed_(), rows = readRows_(), seen = {}, added = [];
  rows.forEach(function (r) { if (r.key) seen[r.key] = true; });
  res.list.forEach(function (p) {
    p.key = dedupKey(p);
    if (p.key && seen[p.key]) return;
    if (p.key) seen[p.key] = true;
    p.cls = classify(p, fixed, cfg['이름'], cfg['수입키워드']);
    p.raw = blob;
    p.id = newId_();
    if (isCardType(p.type)) handleCard_(p, rows, cfg); else handleBank_(p, rows);
    appendTx_(p);
    rows.push(p);
    added.push({ type: p.type, desc: p.desc, amount: p.amount, cls: p.cls, source: p.source });
  });
  return { ok: true, parsed: true, added: added };
}

function setRowFields_(row, desc, cls) {
  var sh = sheet_(SHEET_TX);
  if (desc !== null) sh.getRange(row._row, 6).setValue(desc);
  if (cls !== null) sh.getRange(row._row, 10).setValue(cls);
}

/** 신용카드: 달러 금액 확정 + 누적으로 놓친 결제 찾기 (같은 카드끼리) */
function handleCard_(p, rows, cfg) {
  var sd = Number(cfg['사이클시작일']) || 1, cyc = cycleKeyOf(p.time, sd), prev = null, later = false;
  rows.forEach(function (r) {
    if (!isCardType(r.type) || r.source !== p.source || r.cumulative === null || r.cumulative === undefined) return;
    if (cycleKeyOf(r.time, sd) !== cyc) return;
    if (dtNum(r.time) <= dtNum(p.time)) { if (!prev || dtNum(r.time) >= dtNum(prev.time)) prev = r; }
    else later = true;
  });

  if (p.currency === 'USD' && !p.amount) {
    if (prev && p.cumulative !== null && p.cumulative > prev.cumulative) {
      p.amount = p.cumulative - prev.cumulative; p.desc += ' (원화 승인액)';
    } else {
      p.amount = convertUsd(p.fx, Number(cfg['USDKRW']) || 0, Number(cfg['해외수수료율']) || 0); p.desc += ' (예상)';
    }
  }

  if (later) {
    for (var i = rows.length - 1; i >= 0; i--) {
      var g = rows[i];
      if (g.type === '카드누락추정' && g.source === p.source && g.cls === '생활' && g.amount === p.amount &&
          g.dir === p.dir && g._row && daysBetween(g.time, p.time) <= 3) {
        setRowFields_(g, g.desc + ' → 나중에 온 알림으로 확인됨', '제외'); g.cls = '제외';
        return;
      }
    }
    return;
  }
  var gap = prev ? kbCumGap(prev.cumulative, p) : 0;
  if (gap !== 0) {
    var gr = { id: newId_(), time: p.time, source: p.source, type: '카드누락추정',
      desc: gap > 0 ? '알림 없이 승인된 카드 결제 (누적으로 찾음)' : '알림 없이 취소된 카드 결제 (누적으로 찾음)',
      amount: Math.abs(gap), dir: gap > 0 ? -1 : 1, months: 1, cls: '생활',
      raw: '직전 누적 ' + prev.cumulative + ' + 이번 ' + p.amount + ' ≠ 이번 누적 ' + p.cumulative };
    appendTx_(gr); rows.push(gr);
  }
}

/** 은행·페이·체크카드: 잔액 대사 (같은 계좌끼리, 순서 뒤바뀜 대비) */
function handleBank_(p, rows) {
  if (p.balance === null || p.balance === undefined || p.noBalanceCheck) return;
  var recent = rows.filter(function (r) {
    return isBankType(r.type) && r.source === p.source && r.balance !== null && r.balance !== undefined;
  }).slice(-10);
  var openGaps = rows.filter(function (r) {
    return r.type === '잔액차이' && r.source === p.source && r.cls === '생활' && daysBetween(r.time, p.time) <= 3;
  });
  var d = decideToss(recent, p, openGaps);
  if (d.resolveId) {
    rows.forEach(function (r) {
      if (r.id === d.resolveId && r._row) { setRowFields_(r, r.desc + ' → 나중에 온 알림으로 확인됨', '제외'); r.cls = '제외'; }
    });
  }
  if (d.gap) {
    var gr = { id: newId_(), time: p.time, source: p.source, type: '잔액차이', desc: '알림 없이 움직인 돈',
      amount: Math.abs(d.gap), dir: d.gap > 0 ? 1 : -1, months: 1, cls: '생활',
      raw: '이번 거래 전 예상 잔액 ' + (p.balance - p.dir * p.amount) + ' / 직전 기록 잔액 ' + recent[recent.length - 1].balance };
    appendTx_(gr); rows.push(gr);
  }
}

function findRow_(id) {
  var rows = readRows_();
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
  return null;
}

function reclass_(id, cls) {
  if (CLASSES.indexOf(cls) < 0) return { ok: false, error: '분류 이름이 올바르지 않아요' };
  var r = findRow_(id);
  if (!r) return { ok: false, error: '거래를 찾지 못했어요' };
  sheet_(SHEET_TX).getRange(r._row, 10).setValue(cls);
  return { ok: true };
}

function editTx_(id, amount, desc) {
  var r = findRow_(id);
  if (!r) return { ok: false, error: '거래를 찾지 못했어요' };
  var sh = sheet_(SHEET_TX);
  if (amount !== undefined && amount !== null && amount !== '') {
    var n = toInt(amount);
    if (!(n > 0)) return { ok: false, error: '금액을 확인해주세요' };
    sh.getRange(r._row, 7).setValue(String(n));
  }
  if (desc !== undefined && desc !== null && String(desc).trim()) sh.getRange(r._row, 6).setValue(String(desc).trim().slice(0, 40));
  return { ok: true };
}

/**
 * 놓친 알림 직접 처리
 *  p: {rawId, kind: card|check|out|in|ignore, amount, desc, months, name, learn, word}
 */
function fixRaw_(p) {
  var sh = sheet_(SHEET_RAW), vals = sh.getDataRange().getValues(), at = -1;
  for (var i = 1; i < vals.length; i++) if (str_(vals[i][5]) === String(p.rawId)) { at = i; break; }
  if (at < 0) return { ok: false, error: '알림을 찾지 못했어요' };
  var v = vals[at], app = str_(v[1]);
  if (p.kind === 'ignore') { sh.getRange(at + 1, 5).setValue('무시'); return { ok: true }; }

  var amount = toInt(p.amount);
  if (!(amount > 0)) return { ok: false, error: '금액을 확인해주세요' };
  var name = String(p.name || app || '직접 입력').trim().slice(0, 20);
  var map = { card: ['카드승인', -1, '신용카드'], check: ['체크결제', -1, '체크카드'], out: ['출금', -1, '은행·페이'], 'in': ['입금', 1, '은행·페이'] };
  var m = map[p.kind];
  if (!m) return { ok: false, error: '종류를 골라주세요' };
  var cfg = readConfig_();
  var o = { id: newId_(), time: str_(v[0]), source: aliasSource(name), type: m[0], desc: String(p.desc || '(이름 미상)').trim().slice(0, 40),
    amount: amount, dir: m[1], months: p.kind === 'card' ? Math.max(1, toInt(p.months) || 1) : 1, balance: null, raw: str_(v[2]) + '\n' + str_(v[3]) };
  o.cls = classify(o, readFixed_(), cfg['이름'], cfg['수입키워드']);
  appendTx_(o);
  sh.getRange(at + 1, 5).setValue('직접처리');

  if (p.learn && String(p.word || '').trim()) {
    var rs = sheet_(SHEET_RULES);
    rs.insertRowAfter(1);
    rs.getRange(2, 1, 1, 6).setValues([[name, m[2], escapeRe(app), escapeRe(String(p.word).trim()), 'Y',
      '앱에서 직접 추가 (' + nowKST().slice(0, 10) + ')']]);
  }
  return { ok: true, id: o.id };
}

function saveSettings_(s) {
  var allow = ['이름', '수입이름', '월수입', '생활비예산', '카드한도', '사이클시작일', '결제일', '카드대금부담'];
  var pairs = {};
  allow.forEach(function (k) { if (s[k] !== undefined && s[k] !== null) pairs[k] = s[k]; });
  ['월수입', '생활비예산', '카드한도'].forEach(function (k) { if (k in pairs) pairs[k] = Math.max(0, toInt(pairs[k])); });
  ['사이클시작일', '결제일'].forEach(function (k) { if (k in pairs) pairs[k] = Math.min(28, Math.max(1, toInt(pairs[k]) || 1)); });
  pairs['설정완료'] = 'Y';
  writeConfig_(pairs);
  return { ok: true };
}

/** 편집기에서 시험용 */
function testIngest() {
  Logger.log(JSON.stringify(ingest_('토스', '토스뱅크 체크카드', '4,000원 결제 | 테스트상점\n잔액 901,676원')));
}

if (typeof module !== 'undefined') {
  module.exports = { toInt: toInt, parseDt: parseDt, inferDateTime: inferDateTime, cycleKeyOf: cycleKeyOf,
    addMonthsKey: addMonthsKey, monthsDiff: monthsDiff, cycleInfo: cycleInfo, splitInstallment: splitInstallment,
    parseKB: parseKB, parseToss: parseToss, parseKBAll: parseKBAll, parseCardMsg: parseCardMsg, parseCardAll: parseCardAll,
    parseBankMsg: parseBankMsg, parseNotification: parseNotification, rulesFromRows: rulesFromRows, ruleMatches: ruleMatches,
    looksLikeMoney: looksLikeMoney, amountsIn: amountsIn, classify: classify, balanceGap: balanceGap,
    cardShare: cardShare, computeSummary: computeSummary, convertUsd: convertUsd, dedupKey: dedupKey,
    kbCumGap: kbCumGap, decideToss: decideToss, daysBetween: daysBetween, fixedFromRows: fixedFromRows,
    DEFAULT_FIXED: DEFAULT_FIXED, DEFAULT_RULES: DEFAULT_RULES, DEFAULT_CONFIG: DEFAULT_CONFIG, escapeRe: escapeRe };
}
