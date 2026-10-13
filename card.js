// 명함 만들기: 양식·로고·내용을 고르면 90 × 50mm 명함을 그려서 PNG로 저장
// 회사명·부서·이름·직급·연락처 줄은 각각 따로 옮기고 크기·색을 바꿀 수 있고, 명함 사진을 읽어 비슷하게 다시 만들 수 있음

const W = 900;              // 명함 설계 단위 (1 = 0.1mm)
const H = 500;
const EXPORT_W = 1063;      // 300dpi 기준 90mm
const EXPORT_H = 591;       //               50mm
const TEXT_COLOR = "#1b1d22";
const SUB_TEXT_COLOR = "#5b616b";
const PT_PER_UNIT = 0.1 / 0.352778; // 설계 단위(0.1mm) → pt

const canvas = document.getElementById("cardCanvas");
const templateGrid = document.getElementById("templateGrid");
const shapeList = document.getElementById("shapeList");
const logoFile = document.getElementById("logoFile");
const logoOptions = document.getElementById("logoOptions");
const logoClear = document.getElementById("logoClear");
const logoSize = document.getElementById("logoSize");
const logoSizeValue = document.getElementById("logoSizeValue");
const langHelp = document.getElementById("langHelp");
const rowList = document.getElementById("rowList");

const FONTS = {
    sans: "Noto Sans KR",
    serif: "Noto Serif KR",
    nanum: "Nanum Gothic"
};

// 언어별 항목 이름과 예시 내용 (예시는 손대지 않았을 때만 언어에 맞게 바꿈)
const ROW_LABELS = {
    ko: { address: "주소", tel: "전화", fax: "팩스", mobile: "휴대폰", email: "이메일" },
    en: { address: "Address", tel: "Tel", fax: "Fax", mobile: "Mobile", email: "E-mail" }
};
const SAMPLES = {
    ko: {
        company: "한빛디자인", name: "홍길동", title: "과장", dept: "디자인팀",
        address: "서울특별시 중구 세종대로 110, 3층", tel: "02-1234-5678", fax: "02-1234-5679",
        mobile: "010-1234-5678", email: "gildong@hanbit.co.kr"
    },
    en: {
        company: "Hanbit Design", name: "Gildong Hong", title: "Manager", dept: "Design Team",
        address: "3F, 110 Sejong-daero, Jung-gu, Seoul", tel: "+82-2-1234-5678", fax: "+82-2-1234-5679",
        mobile: "+82-10-1234-5678", email: "gildong@hanbit.co.kr"
    }
};
const LANG_HELP = {
    ko: "항목 이름을 한글로 써요. (주소, 전화, 팩스 …)",
    en: "항목 이름을 영어로 써요. (Address, Tel, Fax …)",
    custom: "항목 이름을 원하는 대로 고쳐 쓰세요. 비우면 이름 없이 내용만 나와요."
};

// 글자 객체의 기본 모양 (크기는 설계 단위)
const TEXT_BASE = {
    company: { size: 32, weight: 700, color: "main" },
    dept: { size: 21, weight: 400, color: SUB_TEXT_COLOR },
    name: { size: 50, weight: 700, color: TEXT_COLOR },
    title: { size: 24, weight: 400, color: SUB_TEXT_COLOR },
    row: { size: 19, weight: 400, color: TEXT_COLOR, labelWeight: 700, labelColor: "main" }
};
const FIELD_KEYS = ["company", "dept", "name", "title"];

// 색 고르기 버튼 (진한 색 → 밝은 색). 더 많은 색은 색상표 창에서
const PALETTE = [
    ["#111827", "먹색"], ["#374151", "차콜"], ["#6b7280", "회색"], ["#94a3b8", "은색"],
    ["#1e3a8a", "남색"], ["#1d4ed8", "파랑"], ["#0369a1", "바다"], ["#4338ca", "인디고"],
    ["#0f766e", "청록"], ["#15803d", "초록"], ["#4d7c0f", "올리브"], ["#a16207", "겨자"],
    ["#c9a227", "금색"], ["#78350f", "갈색"], ["#c2410c", "주황"], ["#b91c1c", "빨강"],
    ["#9f1239", "와인"], ["#be185d", "자홍"], ["#6d28d9", "보라"], ["#93c5fd", "하늘"],
    ["#bfdbfe", "연하늘"], ["#5eead4", "민트"], ["#bbf7d0", "연두"], ["#fde68a", "레몬"],
    ["#fed7aa", "살구"], ["#fca5a5", "분홍"], ["#fbcfe8", "연분홍"], ["#ddd6fe", "라벤더"],
    ["#e5e7eb", "연회색"], ["#f5f0e6", "아이보리"]
];

/* ========== 상태 ========== */

let rowSeq = 0;
function newRow(key, label, value, join) {
    return { id: ++rowSeq, key: key, label: label, value: value, join: !!join };
}

const state = {
    template: "line",
    main: "#1e3a8a",
    sub: "#93c5fd",
    font: "sans",
    lang: "ko",
    company: SAMPLES.ko.company,
    name: SAMPLES.ko.name,
    title: SAMPLES.ko.title,
    dept: SAMPLES.ko.dept,
    // 연락처 줄. 팩스는 전화 바로 뒤면 같은 줄에 이어 씀 (join)
    rows: [
        newRow("address", "주소", SAMPLES.ko.address),
        newRow("tel", "전화", SAMPLES.ko.tel),
        newRow("fax", "팩스", SAMPLES.ko.fax, true),
        newRow("mobile", "휴대폰", SAMPLES.ko.mobile),
        newRow("email", "이메일", SAMPLES.ko.email)
    ],
    logoSource: null,   // 올린 그대로
    logo: null,         // 화면에 쓰는 로고 (투명 처리 후)
    logoTrim: null,     // 투명 처리로 잘라낸 자리 (원본 픽셀)
    logoName: "",
    logoScale: 1,
    offsets: {},        // 끌어서 옮긴 거리 { logo: [dx, dy], name: [...], "row:3": [...] }
    styles: {},         // 글자 객체별로 바꾼 모양 { name: { color, scale, weight } }
    shapes: [],         // 양식 장식·직접 더한 도형·자유 글자 { id, type, color, x, y, w, h, ... }
    reference: null,    // 올린 명함 사진 (반듯하게 편 것, 겹쳐 보기·로고 잘라오기용)
    refName: "",
    refShow: true,
    refOpacity: 0.35
};

let selected = null;   // 고른 요소 ("logo", "company", "dept", "name", "title", "row:3", "shape:7")
let boxes = [];        // 마지막으로 그린 요소들의 자리 (고르기·끌기용)
let shapeSeq = 0;

/* ========== 색 ========== */

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
    return "#" + rgb.map(function (v) {
        return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    }).join("");
}

function rgbToHsv(rgb) {
    const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return [h, max ? d / max : 0, max];
}

function hsvToRgb(hsv) {
    const h = hsv[0], s = hsv[1], v = hsv[2];
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    const seg = Math.floor(h / 60) % 6;
    const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
    return [(t[0] + m) * 255, (t[1] + m) * 255, (t[2] + m) * 255];
}

function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = function (n) {
        const k = (n + h / 30) % 12;
        return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    return rgbToHex([f(0), f(8), f(4)]);
}

function resolveColor(c) {
    return c === "main" ? state.main : c === "sub" ? state.sub : c;
}

// 색상표 창: 채도·밝기 판, 색상 막대, HEX·RGB 입력, 많은 기본 색, 최근 쓴 색
const ColorPicker = (function () {
    const pop = document.getElementById("colorPop");
    const sv = document.getElementById("cpSv");
    const knob = document.getElementById("cpKnob");
    const hue = document.getElementById("cpHue");
    const hexInput = document.getElementById("cpHex");
    const rgbInputs = ["cpR", "cpG", "cpB"].map(function (id) { return document.getElementById(id); });
    const preview = document.getElementById("cpPreview");
    const grid = document.getElementById("cpGrid");
    const recentBox = document.getElementById("cpRecent");
    const RECENT_KEY = "card-recent-colors";

    let hsv = [220, 0.7, 0.5];
    let onPick = null;
    let anchor = null;
    let startHex = "";

    // 기본 색: 12가지 색상 × 7단계 밝기 + 회색 12단계
    const tones = [[90, 92], [80, 82], [75, 68], [70, 55], [75, 42], [80, 30], [85, 20]];
    const presets = [];
    for (let i = 0; i < 12; i++) presets.push(hslToHex(0, 0, 100 - i * 100 / 11));
    tones.forEach(function (t) {
        for (let hh = 0; hh < 360; hh += 30) presets.push(hslToHex(hh, t[0], t[1]));
    });
    presets.forEach(function (c) { grid.append(colorButton(c)); });

    function colorButton(c) {
        const b = document.createElement("button");
        b.type = "button";
        b.style.background = c;
        b.title = c;
        b.setAttribute("aria-label", c);
        b.addEventListener("click", function () { set(c, true); });
        return b;
    }

    function readRecent() {
        try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; }
    }
    function addRecent(c) {
        const list = [c].concat(readRecent().filter(function (x) { return x !== c; })).slice(0, 12);
        try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* 저장 못 해도 괜찮음 */ }
    }
    function showRecent() {
        recentBox.replaceChildren();
        readRecent().forEach(function (c) { recentBox.append(colorButton(c)); });
        recentBox.parentElement.hidden = !recentBox.children.length;
    }

    function currentHex() {
        return rgbToHex(hsvToRgb(hsv));
    }

    function paint(skip) {
        const hex = currentHex();
        const rgb = hexToRgb(hex);
        sv.style.background = "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, " + rgbToHex(hsvToRgb([hsv[0], 1, 1])) + ")";
        knob.style.left = (hsv[1] * 100) + "%";
        knob.style.top = ((1 - hsv[2]) * 100) + "%";
        knob.style.background = hex;
        preview.style.background = hex;
        if (skip !== "hue") hue.value = Math.round(hsv[0]);
        if (skip !== "hex") hexInput.value = hex;
        if (skip !== "rgb") rgbInputs.forEach(function (input, i) { input.value = rgb[i]; });
    }

    function emit() {
        if (onPick) onPick(currentHex());
    }

    function set(hex, fire, skip) {
        const rgb = hexToRgb(hex);
        if (!rgb) return;
        const next = rgbToHsv(rgb);
        if (next[1] === 0 || next[2] === 0) next[0] = hsv[0]; // 회색이면 색상 막대는 그대로
        hsv = next;
        paint(skip);
        if (fire) emit();
    }

    function svFromPointer(event) {
        const r = sv.getBoundingClientRect();
        hsv[1] = Math.min(1, Math.max(0, (event.clientX - r.left) / r.width));
        hsv[2] = 1 - Math.min(1, Math.max(0, (event.clientY - r.top) / r.height));
        paint();
        emit();
    }
    sv.addEventListener("pointerdown", function (event) {
        sv.setPointerCapture(event.pointerId);
        svFromPointer(event);
    });
    sv.addEventListener("pointermove", function (event) {
        if (sv.hasPointerCapture(event.pointerId)) svFromPointer(event);
    });
    hue.addEventListener("input", function () {
        hsv[0] = Number(hue.value);
        paint("hue");
        emit();
    });
    hexInput.addEventListener("input", function () {
        let v = hexInput.value.trim();
        if (v[0] !== "#") v = "#" + v;
        if (/^#[0-9a-f]{6}$/i.test(v)) set(v, true, "hex");
    });
    rgbInputs.forEach(function (input) {
        input.addEventListener("input", function () {
            const rgb = rgbInputs.map(function (x) { return Number(x.value); });
            if (rgb.every(function (v) { return Number.isFinite(v) && v >= 0 && v <= 255; })) set(rgbToHex(rgb), true, "rgb");
        });
    });
    document.getElementById("cpDone").addEventListener("click", close);

    // 창 밖을 누르면 닫기
    document.addEventListener("pointerdown", function (event) {
        if (!pop.hidden && !pop.contains(event.target) && !(anchor && anchor.contains(event.target))) close();
    }, true);

    function place() {
        const r = anchor.getBoundingClientRect();
        const pw = pop.offsetWidth, ph = pop.offsetHeight;
        let left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
        let top = r.bottom + 6;
        if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
        pop.style.left = left + "px";
        pop.style.top = top + "px";
    }

    function open(anchorEl, color, cb) {
        anchor = anchorEl;
        onPick = cb;
        startHex = resolveColor(color) || "#1e3a8a";
        set(startHex, false);
        showRecent();
        pop.hidden = false;
        place();
        hexInput.focus({ preventScroll: true });
        hexInput.select();
    }

    function close() {
        if (pop.hidden) return;
        pop.hidden = true;
        const hex = currentHex();
        if (hex !== startHex) addRecent(hex);
        onPick = null;
        if (anchor) anchor.focus({ preventScroll: true });
        anchor = null;
    }

    window.addEventListener("resize", function () { if (!pop.hidden) place(); });

    return { open: open, close: close, isOpen: function () { return !pop.hidden; } };
})();

// 색 고르기 줄: 미리 정한 색 버튼 + 색상표 버튼(more). getColor는 색상표를 열 때의 지금 색
// onChange가 false를 돌려주면 (고른 객체에만 적용) 이 줄의 선택 표시는 그대로
function setupSwatches(group, more, getColor, onChange) {
    function select(el) {
        group.querySelectorAll("button").forEach(function (b) { b.classList.toggle("active", b === el); });
    }
    group.addEventListener("click", function (event) {
        const target = event.target.closest("button");
        if (!target) return;
        if (target === more) {
            ColorPicker.open(more, getColor(), function (color) {
                if (onChange(color) !== false) {
                    select(more);
                    more.style.setProperty("--picked", color);
                }
            });
            return;
        }
        if (onChange(target.dataset.value) !== false) select(target);
    });
}

// 줄의 선택 표시를 지금 색에 맞추기 (기본 색에 없으면 색상표 버튼에 표시)
function markSwatch(group, color) {
    const more = group.querySelector(".more-colors");
    let matched = false;
    color = String(color).toLowerCase();
    group.querySelectorAll("button").forEach(function (b) {
        const on = b !== more && (b.dataset.value || "").toLowerCase() === color;
        b.classList.toggle("active", on);
        if (on) matched = true;
    });
    if (more) {
        more.classList.toggle("active", !matched);
        if (!matched) more.style.setProperty("--picked", color);
    }
}

/* ========== 양식 ========== */

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// 양식 장식은 고칠 수 있는 객체 목록으로 정의 (색 "main"/"sub"는 주·보조 색상을 따라감)
// 객체: { type, name, color, x, y, w, h, stroke(테두리 굵기, 0이면 채움), radius, points(0~1 비율 좌표) }
function deco(type, name, color, x, y, w, h, extra) {
    return Object.assign({ type: type, name: name, color: color, x: x, y: y, w: w, h: h, stroke: 0, radius: 0 }, extra || {});
}
const CORNER_POINTS = {
    nw: [[1, 0], [0, 0], [0, 1]], ne: [[0, 0], [1, 0], [1, 1]],
    se: [[1, 0], [1, 1], [0, 1]], sw: [[0, 0], [0, 1], [1, 1]]
};

// pad: 글자를 놓을 안쪽 여백 [위, 오른쪽, 아래, 왼쪽], align: 글자 정렬
const TEMPLATES = [
    { id: "plain", name: "기본", align: "left", pad: [60, 60, 56, 64], deco: function () { return []; } },
    {
        id: "line", name: "얇은 테두리", align: "left", pad: [62, 64, 58, 66],
        deco: function () { return [deco("rect", "테두리", "main", 22, 22, W - 44, H - 44, { stroke: 3 })]; }
    },
    {
        id: "double", name: "이중 테두리", align: "left", pad: [66, 70, 62, 72],
        deco: function () {
            return [
                deco("rect", "바깥 테두리", "main", 16, 16, W - 32, H - 32, { stroke: 5 }),
                deco("rect", "안쪽 테두리", "sub", 30, 30, W - 60, H - 60, { stroke: 2 })
            ];
        }
    },
    {
        id: "rounded", name: "둥근 테두리", align: "left", pad: [64, 66, 60, 68],
        deco: function () { return [deco("rect", "둥근 테두리", "main", 22, 22, W - 44, H - 44, { stroke: 4, radius: 36 })]; }
    },
    {
        id: "leftbar", name: "왼쪽 띠", align: "left", pad: [58, 60, 54, 92],
        deco: function () {
            return [deco("rect", "왼쪽 띠", "main", 0, 0, 30, H), deco("rect", "보조 띠", "sub", 30, 0, 9, H)];
        }
    },
    {
        id: "bottomband", name: "아래 띠", align: "left", pad: [50, 60, 82, 64],
        deco: function () {
            return [deco("rect", "보조 띠", "sub", 0, H - 46, W, 8), deco("rect", "아래 띠", "main", 0, H - 38, W, 38)];
        }
    },
    {
        id: "topbottom", name: "위·아래 선", align: "left", pad: [60, 60, 56, 64],
        deco: function () {
            return [
                deco("rect", "위 선", "main", 0, 0, W, 14), deco("rect", "위 보조 선", "sub", 0, 14, W, 4),
                deco("rect", "아래 보조 선", "sub", 0, H - 18, W, 4), deco("rect", "아래 선", "main", 0, H - 14, W, 14)
            ];
        }
    },
    {
        id: "corners", name: "모서리 장식", align: "left", pad: [64, 66, 60, 68],
        deco: function () {
            const m = 24, len = 72;
            return [
                deco("polyline", "왼쪽 위 모서리", "main", m, m, len, len, { stroke: 5, points: CORNER_POINTS.nw }),
                deco("polyline", "오른쪽 위 모서리", "main", W - m - len, m, len, len, { stroke: 5, points: CORNER_POINTS.ne }),
                deco("polyline", "오른쪽 아래 모서리", "main", W - m - len, H - m - len, len, len, { stroke: 5, points: CORNER_POINTS.se }),
                deco("polyline", "왼쪽 아래 모서리", "main", m, H - m - len, len, len, { stroke: 5, points: CORNER_POINTS.sw })
            ];
        }
    },
    {
        id: "corner-tri", name: "사선 포인트", align: "left", pad: [60, 60, 56, 64],
        deco: function () {
            const tri = [[0, 1], [1, 0], [1, 1]];
            return [
                deco("poly", "큰 사선", "sub", W - 330, H - 210, 330, 210, { points: tri }),
                deco("poly", "작은 사선", "main", W - 200, H - 128, 200, 128, { points: tri })
            ];
        }
    },
    {
        id: "circles", name: "원 포인트", align: "left", pad: [60, 230, 56, 64],
        deco: function () {
            return [
                deco("circle", "큰 원", "sub", W + 30 - 230, H / 2 - 230, 460, 460),
                deco("circle", "작은 원", "main", W + 40 - 160, H / 2 - 160, 320, 320)
            ];
        }
    },
    {
        id: "center", name: "가운데 정렬", align: "center", pad: [44, 60, 44, 60],
        deco: function () {
            return [
                deco("rect", "테두리", "sub", 20, 20, W - 40, H - 40, { stroke: 2 }),
                deco("rect", "아래 포인트", "main", W / 2 - 30, H - 34, 60, 6)
            ];
        }
    },
    {
        id: "right", name: "오른쪽 정렬", align: "right", pad: [60, 66, 56, 60],
        deco: function () {
            return [deco("rect", "왼쪽 선", "main", 0, 0, 14, H), deco("rect", "가운데 선", "sub", 66, H / 2 - 1, 120, 3)];
        }
    }
];

// 지금 양식의 장식을 고칠 수 있는 객체로 (직접 더한 도형은 그 위에 그대로)
function applyTemplateDeco() {
    const own = state.shapes.filter(function (sh) { return !sh.deco; });
    const decos = findTemplate(state.template).deco().map(function (d) {
        return Object.assign(d, { id: ++shapeSeq, deco: true, baseColor: d.color });
    });
    state.shapes = decos.concat(own);
}

function findTemplate(id) {
    return TEMPLATES.find(function (t) { return t.id === id; }) || TEMPLATES[0];
}

/* ========== 그리기 ========== */

function fontOf(weight, size) {
    return weight + " " + size + "px \"" + FONTS[state.font] + "\", \"Noto Sans KR\", sans-serif";
}

// 글자 조각들 [{ text, weight, size, color, gap, minWidth }]을 한 줄로 그릴 때의 너비
function measureLine(ctx, parts, k) {
    let width = 0;
    parts.forEach(function (p) {
        ctx.font = fontOf(p.weight, p.size * k);
        width += Math.max(ctx.measureText(p.text).width, (p.minWidth || 0) * k) + (p.gap || 0) * k;
    });
    return width;
}

function drawParts(ctx, parts, x, baseline, k) {
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    parts.forEach(function (p) {
        ctx.font = fontOf(p.weight, p.size * k);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, x, baseline);
        x += Math.max(ctx.measureText(p.text).width, (p.minWidth || 0) * k) + (p.gap || 0) * k;
    });
}

// 너무 길면 maxWidth에 맞게 글자를 줄임 (최대 55%까지)
function fitScale(width, maxWidth) {
    return width > maxWidth ? Math.max(0.55, maxWidth / width) : 1;
}

function offsetOf(key) {
    return state.offsets[key] || [0, 0];
}

function isTextKey(key) {
    return !!key && (FIELD_KEYS.indexOf(key) >= 0 || key.indexOf("row:") === 0);
}

function rowOf(key) {
    if (!key || key.indexOf("row:") !== 0) return null;
    const id = Number(key.slice(4));
    return state.rows.find(function (r) { return r.id === id; }) || null;
}

// 글자 객체의 지금 모양 (기본 + 바꾼 것)
function textStyle(key) {
    const base = TEXT_BASE[key.indexOf("row:") === 0 ? "row" : key];
    const own = state.styles[key] || {};
    const scale = own.scale || 1;
    return {
        scale: scale,
        size: base.size * scale,
        weight: own.weight || base.weight,
        color: resolveColor(own.color || base.color),
        labelColor: resolveColor(own.color || base.labelColor || base.color),
        labelWeight: own.labelWeight || base.labelWeight || base.weight,
        labelGap: own.labelGap != null ? own.labelGap : 12
    };
}

function setTextScale(key, scale) {
    const own = state.styles[key] || (state.styles[key] = {});
    own.scale = Math.min(6, Math.max(0.25, scale));
}

function labelOf(row) {
    return row.label ? row.label.trim() : "";
}

// 글자 객체 하나: 회사명·부서·이름·직급은 한 조각, 연락처 줄은 항목 이름 + 내용
function fieldItem(key, text) {
    const st = textStyle(key);
    return { key: key, scale: st.scale, parts: [{ text: text, weight: st.weight, size: st.size, color: st.color }] };
}

function rowItem(row, labelWidth) {
    const key = "row:" + row.id;
    const st = textStyle(key);
    const parts = [];
    const label = labelOf(row);
    if (label) {
        parts.push({ text: label, weight: st.labelWeight, size: st.size, color: st.labelColor, gap: st.labelGap * st.scale, minWidth: labelWidth * st.scale });
    }
    parts.push({ text: row.value.trim(), weight: st.weight, size: st.size, color: st.color });
    return { key: key, scale: st.scale, parts: parts };
}

function shapePoints(s) {
    if (s.points) return s.points;
    if (s.type === "triangle") return [[0.5, 0], [1, 1], [0, 1]];
    return null;
}

function drawShape(ctx, s) {
    const color = resolveColor(s.color);
    ctx.save();
    if (s.type === "text") {
        // 자유 글자: (x, y)가 글자 칸의 왼쪽 위, 크기에 맞춰 칸 너비·높이를 다시 잼
        ctx.font = fontOf(s.weight || 400, s.size);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = color;
        s.w = Math.max(8, ctx.measureText(s.text || " ").width);
        s.h = s.size * 1.25;
        ctx.fillText(s.text || "", s.x, s.y + s.size);
        ctx.restore();
        return;
    }
    const stroke = s.type === "line" ? 0 : s.stroke || 0;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = stroke;
    ctx.lineJoin = "miter";
    ctx.lineCap = s.type === "polyline" ? "square" : "butt";
    const pts = shapePoints(s);
    if (s.type === "circle") {
        ctx.beginPath();
        ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w) / 2, Math.abs(s.h) / 2, 0, 0, Math.PI * 2);
    } else if (pts) {
        ctx.beginPath();
        pts.forEach(function (pt, i) {
            const px = s.x + pt[0] * s.w, py = s.y + pt[1] * s.h;
            if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        });
        if (s.type !== "polyline") ctx.closePath();
    } else if (s.radius) {
        roundRectPath(ctx, s.x, s.y, s.w, s.h, Math.min(s.radius, s.w / 2, s.h / 2));
    } else {
        ctx.beginPath();
        ctx.rect(s.x, s.y, s.w, s.h);
    }
    if (stroke || s.type === "polyline") ctx.stroke();
    else ctx.fill();
    ctx.restore();
}

// 점이 도형 위에 있는지 (테두리만 있는 도형은 선 근처만, 큰 테두리가 빈 곳 클릭을 가로채지 않게)
function shapeHit(s, p, tol) {
    const stroke = s.type === "line" || s.type === "text" ? 0 : s.stroke || 0;
    const half = stroke / 2 + tol;
    if (p[0] < s.x - half || p[0] > s.x + s.w + half || p[1] < s.y - half || p[1] > s.y + s.h + half) return false;
    if (s.type === "polyline") {
        const pts = s.points.map(function (pt) { return [s.x + pt[0] * s.w, s.y + pt[1] * s.h]; });
        for (let i = 1; i < pts.length; i++) {
            if (segmentDistance(p, pts[i - 1], pts[i]) <= half) return true;
        }
        return false;
    }
    if (s.type === "circle") {
        const rx = s.w / 2, ry = s.h / 2;
        const d = Math.hypot((p[0] - s.x - rx) / rx, (p[1] - s.y - ry) / ry);
        const band = half / Math.min(rx, ry);
        return stroke ? Math.abs(d - 1) <= band : d <= 1 + band;
    }
    if (!stroke) return true;
    // 테두리만: 안쪽 빈 곳은 제외
    return !(p[0] > s.x + half && p[0] < s.x + s.w - half && p[1] > s.y + half && p[1] < s.y + s.h - half);
}

function segmentDistance(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// 줄들을 배치: 각 줄은 { items, height, descent } (높이는 글자 배율 반영 전 기본값)
// 줄 안 객체는 왼쪽부터 이어 놓고, 줄 전체를 align에 맞춤. 객체마다 자리(x, top, baseline)를 돌려줌
function placeLines(ctx, lines, x, top, align, maxWidth) {
    let k = 1;
    lines.forEach(function (line) {
        line.widths = line.items.map(function (it) { return measureLine(ctx, it.parts, 1); });
        if (line.gap == null) line.gap = line.items.length > 1 ? 26 : 0;
        const w = line.widths.reduce(function (a, b) { return a + b; }, 0) + line.gap * (line.items.length - 1);
        k = Math.min(k, fitScale(w, maxWidth));
    });
    const placed = [];
    let y = top;
    lines.forEach(function (line) {
        const scale = Math.max.apply(null, line.items.map(function (it) { return it.scale; }));
        const lh = line.height * scale * k;
        const widths = line.items.map(function (it) { return measureLine(ctx, it.parts, k); });
        const total = widths.reduce(function (a, b) { return a + b; }, 0) + line.gap * k * (line.items.length - 1);
        let cx = align === "left" ? x : align === "right" ? x - total : x - total / 2;
        const baseline = y + lh - line.descent * scale * k;
        line.items.forEach(function (it, i) {
            placed.push({ item: it, x: cx, top: y, h: lh, baseline: baseline, w: widths[i], k: k });
            cx += widths[i] + line.gap * k;
        });
        y += lh;
    });
    return { placed: placed, height: y - top };
}

function linesHeight(ctx, lines, maxWidth) {
    return placeLines(ctx, lines, 0, 0, "left", maxWidth).height;
}

// 명함 한 장 그리기 (설계 단위 W × H 좌표). 각 요소의 자리를 돌려줌
function drawCard(ctx, templateId, useOffsets) {
    const t = findTemplate(templateId);
    const found = [];

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // 지금 양식은 고친 장식 그대로, 다른 양식(고르기 칸)은 그 양식의 기본 장식 + 직접 더한 도형
    const shapes = templateId === state.template ? state.shapes
        : t.deco().concat(state.shapes.filter(function (sh) { return !sh.deco; }));
    shapes.forEach(function (s) {
        drawShape(ctx, s);
        found.push({ key: "shape:" + s.id, x: s.x, y: s.y, w: s.w, h: s.h, shape: s });
    });

    const x0 = t.pad[3], y0 = t.pad[0], x1 = W - t.pad[1], y1 = H - t.pad[2];
    const align = t.align;
    const ax = align === "left" ? x0 : align === "right" ? x1 : (x0 + x1) / 2;
    const maxWidth = x1 - x0;
    function off(key) { return useOffsets ? offsetOf(key) : [0, 0]; }

    // 머리: 로고 + 회사명
    let headBottom = y0;
    let logoW = 0, logoH = 0;
    if (state.logo) {
        logoH = 70 * state.logoScale;
        logoW = logoH * state.logo.width / state.logo.height;
        if (logoW > W) { logoH *= W / logoW; logoW = W; }
        const lx = (align === "left" ? x0 : align === "right" ? x1 - logoW : ax - logoW / 2) + off("logo")[0];
        const ly = y0 + off("logo")[1];
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(state.logo, lx, ly, logoW, logoH);
        found.push({ key: "logo", x: lx, y: ly, w: logoW, h: logoH });
        headBottom = y0 + Math.min(logoH, 160);
    }

    const placed = [];
    if (state.company.trim()) {
        const lines = [{ items: [fieldItem("company", state.company.trim())], height: 44, descent: 10 }];
        let cx = ax, top, room = maxWidth;
        if (state.logo && align !== "center") {
            // 로고 옆에, 로고 높이의 가운데에
            cx = align === "left" ? x0 + logoW + 18 : x1 - logoW - 18;
            room = Math.max(120, maxWidth - logoW - 18);
            top = y0 + Math.max(0, (Math.min(logoH, 160) - linesHeight(ctx, lines, room)) / 2);
        } else {
            top = state.logo ? headBottom + 8 : y0;
        }
        const r = placeLines(ctx, lines, cx, top, align, room);
        placed.push.apply(placed, r.placed);
        headBottom = Math.max(headBottom, top + r.height);
    }

    // 연락처: 아래에서부터. 왼쪽 정렬이면 항목 이름 너비를 맞춰 내용이 세로로 가지런하게
    let labelWidth = 0;
    const visibleRows = state.rows.filter(function (row) { return row.value.trim(); });
    if (align === "left") {
        visibleRows.forEach(function (row) {
            if (!labelOf(row)) return;
            ctx.font = fontOf(TEXT_BASE.row.labelWeight, TEXT_BASE.row.size);
            labelWidth = Math.max(labelWidth, ctx.measureText(labelOf(row)).width);
        });
    }
    const infoLines = [];
    visibleRows.forEach(function (row, i) {
        const item = rowItem(row, labelWidth);
        const prev = visibleRows[i - 1];
        if (row.join && prev && prev.key === "tel" && infoLines.length) {
            item.parts[0].minWidth = 0; // 이어 쓰는 항목은 칸 맞춤 없이
            infoLines[infoLines.length - 1].items.push(item);
        } else {
            infoLines.push({ items: [item], height: 30, descent: 8 });
        }
    });
    let infoTop = y1;
    if (infoLines.length) {
        infoTop = y1 - linesHeight(ctx, infoLines, maxWidth);
        placed.push.apply(placed, placeLines(ctx, infoLines, ax, infoTop, align, maxWidth).placed);
    }

    // 부서 / 이름 + 직급: 머리와 연락처 사이 가운데
    const nameLines = [];
    if (state.dept.trim()) nameLines.push({ items: [fieldItem("dept", state.dept.trim())], height: 34, descent: 8 });
    const nameLine = { items: [], height: 62, descent: 12 };
    if (state.name.trim()) nameLine.items.push(fieldItem("name", state.name.trim()));
    if (state.title.trim()) nameLine.items.push(fieldItem("title", state.title.trim()));
    if (nameLine.items.length) {
        if (nameLine.items.length === 2) nameLine.gap = 14;
        else if (nameLine.items[0].key === "title") { nameLine.height = 36; nameLine.descent = 8; }
        nameLines.push(nameLine);
    }
    if (nameLines.length) {
        const h = linesHeight(ctx, nameLines, maxWidth);
        const top = headBottom + Math.max(10, (infoTop - headBottom - h) / 2 - 6);
        placed.push.apply(placed, placeLines(ctx, nameLines, ax, top, align, maxWidth).placed);
    }

    // 글자 객체 그리기 (각자 옮긴 만큼)
    placed.forEach(function (p) {
        const o = off(p.item.key);
        drawParts(ctx, p.item.parts, p.x + o[0], p.baseline + o[1], p.k);
        const size = p.item.parts[p.item.parts.length - 1].size * p.k;
        found.push({ key: p.item.key, x: p.x + o[0], y: p.top + o[1], w: p.w, h: p.h, baseline: p.baseline + o[1], size: size, text: true });
    });

    return found;
}

/* ========== 화면 ========== */

let renderQueued = false;

function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
        renderQueued = false;
        renderPreview();
        renderTemplates();
        loadFonts();
    });
}

// 웹 글꼴은 글자 범위별로 나뉘어 있어서, 캔버스에 쓸 글자가 든 파일을 직접 불러야 함
const fontTried = new Set();
function loadFonts() {
    if (!document.fonts) return;
    const text = [state.company, state.name, state.title, state.dept]
        .concat(state.rows.map(function (r) { return r.label + r.value; }))
        .concat(state.shapes.map(function (s) { return s.text || ""; })).join("");
    [400, 700].forEach(function (weight) {
        const font = fontOf(weight, 20);
        const key = font + "|" + text;
        if (fontTried.has(key) || document.fonts.check(font, text)) return;
        fontTried.add(key);
        document.fonts.load(font, text).then(function (faces) {
            if (faces.length) render();
        }, function () {});
    });
}

function renderPreview() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssW * dpr * H / W);
    const ctx = canvas.getContext("2d");
    const k = canvas.width / W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    boxes = drawCard(ctx, state.template, true);
    const px = W / canvas.clientWidth; // 화면 1px의 설계 단위

    // 올린 명함을 겹쳐 보기 (저장되는 그림에는 안 들어감)
    if (state.reference && state.refShow) {
        ctx.save();
        ctx.globalAlpha = state.refOpacity;
        ctx.drawImage(state.reference, 0, 0, W, H);
        ctx.restore();
    }

    // 로고 잘라오기 네모
    if (cropRect) {
        ctx.save();
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.lineWidth = 2 * px;
        ctx.strokeStyle = "#ea580c";
        ctx.fillStyle = "rgba(234, 88, 12, 0.08)";
        const r = normRect(cropRect);
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.restore();
    }

    // 고른 요소 표시와 크기 조절 손잡이
    const box = boxes.find(function (b) { return b.key === selected; });
    if (box) {
        const handles = handlesOf(box);
        const pad = box.text ? 4 : 0;
        ctx.save();
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.lineWidth = 1.5 * px;
        ctx.strokeStyle = "#03b75a";
        ctx.strokeRect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2);
        ctx.setLineDash([]);
        ctx.fillStyle = "#ffffff";
        handles.forEach(function (h) {
            const r = HANDLE_PX / 2 * px;
            ctx.fillRect(h.x - r, h.y - r, r * 2, r * 2);
            ctx.strokeRect(h.x - r, h.y - r, r * 2, r * 2);
        });
        ctx.restore();
    }
    syncSelectionBar();
}

// 양식 고르기 칸: 지금 내용과 색으로 작게 그려서 보여 줌
function renderTemplates() {
    templateGrid.querySelectorAll("canvas").forEach(function (c) {
        const ctx = c.getContext("2d");
        const k = c.width / W;
        ctx.setTransform(k, 0, 0, k, 0, 0);
        drawCard(ctx, c.dataset.template, false);
    });
}

function markTemplate() {
    templateGrid.querySelectorAll("button").forEach(function (b) {
        const on = b.dataset.value === state.template;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on);
    });
}

function buildTemplateGrid() {
    TEMPLATES.forEach(function (t) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "template";
        button.dataset.value = t.id;
        const c = document.createElement("canvas");
        c.width = 360;
        c.height = 200;
        c.dataset.template = t.id;
        const name = document.createElement("span");
        name.textContent = t.name;
        button.append(c, name);
        templateGrid.append(button);
    });
    markTemplate();
    templateGrid.addEventListener("click", function (event) {
        const target = event.target.closest("button");
        if (!target) return;
        state.template = target.dataset.value;
        state.offsets = {}; // 양식마다 자리가 달라서 옮긴 위치는 처음대로
        if (shapeOf() && shapeOf().deco) selected = null;
        applyTemplateDeco();
        buildShapeList();
        markTemplate();
        render();
    });
}

/* ========== 내용 입력 ========== */

function bindText(id) {
    const input = document.getElementById(id);
    input.value = state[id];
    input.addEventListener("input", function () {
        state[id] = input.value;
        render();
    });
}

function syncFieldInputs() {
    FIELD_KEYS.forEach(function (key) {
        const input = document.getElementById(key);
        if (document.activeElement !== input) input.value = state[key];
    });
}

function buildRows() {
    rowList.replaceChildren();
    state.rows.forEach(function (row) {
        const line = document.createElement("div");
        line.className = "info-row";

        // 직접 입력 모드이거나 추가한 항목이면 항목 이름도 고칠 수 있게
        const editable = state.lang === "custom" || !ROW_LABELS.ko[row.key];
        let label;
        if (editable) {
            label = document.createElement("input");
            label.type = "text";
            label.className = "text-input info-label-input";
            label.value = row.label;
            label.placeholder = "항목 이름";
            label.setAttribute("aria-label", "항목 이름");
            label.addEventListener("input", function () {
                row.label = label.value;
                render();
            });
        } else {
            label = document.createElement("span");
            label.className = "info-label";
            label.textContent = row.label;
        }

        const value = document.createElement("input");
        value.type = row.key === "email" ? "email" : "text";
        value.className = "text-input";
        value.value = row.value;
        value.dataset.row = row.id;
        value.setAttribute("aria-label", (row.label || "추가 항목") + " 내용");
        value.addEventListener("input", function () {
            row.value = value.value;
            render();
        });

        line.append(label, value);

        if (!ROW_LABELS.ko[row.key]) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "file-remove";
            remove.textContent = "×";
            remove.title = "이 항목 삭제";
            remove.setAttribute("aria-label", remove.title);
            remove.addEventListener("click", function () {
                state.rows.splice(state.rows.indexOf(row), 1);
                if (selected === "row:" + row.id) selected = null;
                buildRows();
                render();
            });
            line.append(remove);
            line.classList.add("removable");
        }
        rowList.append(line);
    });
}

function markLang() {
    document.querySelectorAll("#langSelect button").forEach(function (b) {
        b.classList.toggle("active", b.dataset.value === state.lang);
    });
    langHelp.textContent = LANG_HELP[state.lang];
}

function setLang(lang) {
    const before = state.lang;
    state.lang = lang;
    markLang();

    if (lang !== "custom") {
        // 기본 항목 이름을 언어에 맞게
        state.rows.forEach(function (row) {
            if (ROW_LABELS[lang][row.key]) row.label = ROW_LABELS[lang][row.key];
        });
        // 예시 그대로인 칸은 그 언어의 예시로 바꿔 줌
        const from = before === "custom" ? null : SAMPLES[before];
        if (from && from !== SAMPLES[lang]) {
            FIELD_KEYS.forEach(function (key) {
                if (state[key] === from[key]) state[key] = SAMPLES[lang][key];
            });
            state.rows.forEach(function (row) {
                if (from[row.key] && row.value === from[row.key]) row.value = SAMPLES[lang][row.key];
            });
            syncFieldInputs();
        }
    }
    buildRows();
    render();
}

/* ========== 로고 ========== */

// 불투명한 부분을 감싸는 자리 (없으면 null)
function alphaBounds(c) {
    const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
    for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
            if (data[(y * c.width + x) * 4 + 3] > 8) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function updateLogo() {
    const src = state.logoSource;
    state.logo = src;
    state.logoTrim = src ? { x: 0, y: 0, w: src.width, h: src.height } : null;
    if (src && logoClear.checked) {
        const cut = ImageKit.removeBackgroundColor(src, 40);
        const b = alphaBounds(cut);
        if (b) {
            const out = document.createElement("canvas");
            out.width = b.w;
            out.height = b.h;
            out.getContext("2d").drawImage(cut, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
            state.logo = out;
            state.logoTrim = b;
        }
    }
    render();
}

function showLogoFile() {
    logoFile.replaceChildren();
    logoFile.hidden = !state.logoSource;
    logoOptions.hidden = !state.logoSource;
    if (!state.logoSource) return;
    logoFile.append(fileChip(state.logoName, removeLogo));
}

function fileChip(name, onRemove) {
    const chip = document.createElement("span");
    chip.className = "file-chip";
    const text = document.createElement("span");
    text.textContent = name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "file-remove";
    remove.textContent = "×";
    remove.title = name + " 삭제";
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", onRemove);
    chip.append(text, remove);
    return chip;
}

function removeLogo() {
    state.logoSource = null;
    delete state.offsets.logo;
    if (selected === "logo") selected = null;
    showLogoFile();
    updateLogo();
}

async function handleLogo(file) {
    try {
        state.logoSource = await ImageKit.fileToCanvas(file);
    } catch (error) {
        alert(error.message);
        return;
    }
    state.logoName = file.name || "붙여넣은 이미지";
    delete state.offsets.logo;
    showLogoFile();
    updateLogo();
}

function setLogoScale(scale) {
    state.logoScale = Math.min(6, Math.max(0.1, scale));
    logoSize.value = Math.round(state.logoScale * 100);
    logoSizeValue.textContent = Math.round(state.logoScale * 100) + "%";
    render();
}

/* ========== 객체 (도형·장식·자유 글자·글자 칸·로고) ========== */

const SHAPE_NAMES = { rect: "사각형", circle: "원", line: "선", triangle: "삼각형", poly: "다각형", polyline: "꺾은선", text: "글자" };
const FIELD_NAMES = { logo: "로고", company: "회사명", dept: "부서", name: "이름", title: "직급" };
const HANDLE_PX = 10;            // 크기 조절 손잡이 크기 (화면 px)
const CLIP_MARK = "명함도형:";   // 클립보드에 넣는 도형 표시
const CURSORS = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

const selectionBar = document.getElementById("selectionBar");
const selectionName = document.getElementById("selectionName");
const selectionColor = document.getElementById("selectionColor");
const selectionText = document.getElementById("selectionText");
const selectionTextInput = document.getElementById("selectionTextInput");
const selColors = document.getElementById("selColors");
const boldCheckWrap = document.getElementById("boldCheckWrap");
const boldCheck = document.getElementById("boldCheck");
const colorResetButton = document.getElementById("colorResetButton");
const sizeGrid = document.getElementById("sizeGrid");
const copyButton = document.getElementById("copyButton");
const pasteButton = document.getElementById("pasteButton");
const deleteButton = document.getElementById("deleteButton");
const mainColorNote = document.getElementById("mainColorNote");
const toast = document.getElementById("toast");

let copied = null;     // 복사한 도형·글자
let barKey = null;     // 편집 칸을 만든 대상 (바뀔 때만 다시 만들기)

function shapeOf(key) {
    key = key || selected;
    if (!key || key.indexOf("shape:") !== 0) return null;
    return state.shapes.find(function (s) { return "shape:" + s.id === key; }) || null;
}

function shapeTitle(s) {
    if (s.type === "text") return "글자 '" + (s.text || "").slice(0, 12) + "'";
    if (s.name) return s.name;
    const own = state.shapes.filter(function (sh) { return !sh.deco && !sh.name && sh.type !== "text"; });
    return SHAPE_NAMES[s.type] + " " + (own.indexOf(s) + 1);
}

function keyTitle(key) {
    const s = shapeOf(key);
    if (s) return shapeTitle(s);
    const row = rowOf(key);
    if (row) return (labelOf(row) || "연락처") + " 줄";
    return FIELD_NAMES[key] || "";
}

function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { toast.hidden = true; }, 1800);
}

// 지금 배치를 화면에 그리지 않고 계산 (자리 보정용)
const scratch = document.createElement("canvas").getContext("2d");
function layoutBoxes() {
    return drawCard(scratch, state.template, true);
}
function boxOf(key) {
    return layoutBoxes().find(function (b) { return b.key === key; }) || null;
}

// 글자 칸·로고를 원하는 자리(왼쪽 위)로 옮기기
function moveKeyTo(key, x, y) {
    const b = boxOf(key);
    if (!b) return;
    const o = offsetOf(key);
    state.offsets[key] = [o[0] + x - b.x, o[1] + y - b.y];
}

function addShape(type) {
    let s;
    if (type === "text") {
        s = { id: ++shapeSeq, type: "text", text: "새 글자", size: 26, weight: 400, color: TEXT_COLOR, x: 360, y: 230, w: 100, h: 32 };
    } else {
        const size = { rect: [200, 100], circle: [100, 100], line: [300, 6], triangle: [120, 100] }[type];
        s = {
            id: ++shapeSeq, type: type, color: state.main, stroke: 0, radius: 0,
            w: size[0], h: size[1], x: Math.round((W - size[0]) / 2), y: Math.round((H - size[1]) / 2)
        };
    }
    state.shapes.push(s);
    selected = "shape:" + s.id;
    buildShapeList();
    render();
    if (type === "text") {
        requestAnimationFrame(function () { selectionTextInput.focus(); selectionTextInput.select(); });
    }
}

// 복사: 도형·자유 글자는 그대로, 글자 칸(이름 등)은 같은 모양의 자유 글자로
function copySelection() {
    const s = shapeOf();
    if (s) {
        copied = JSON.parse(JSON.stringify(s));
    } else if (isTextKey(selected)) {
        const b = boxOf(selected);
        const st = textStyle(selected);
        const row = rowOf(selected);
        const text = row ? (labelOf(row) ? labelOf(row) + "  " : "") + row.value.trim() : state[selected].trim();
        if (!b || !text) return null;
        copied = { type: "text", text: text, size: b.size, weight: st.weight, color: st.color, x: b.x, y: b.baseline - b.size, w: b.w, h: b.size * 1.25 };
    } else {
        showToast(selected === "logo" ? "로고는 복사할 수 없어요" : "복사할 수 없는 객체예요");
        return null;
    }
    pasteButton.disabled = false;
    showToast(keyTitle(selected) + " 복사함");
    return copied;
}

// 붙여넣기: 원본보다 2mm씩 옆에 (다시 붙이면 또 2mm 옆에)
function pasteShape(source) {
    if (!source || !SHAPE_NAMES[source.type]) return;
    const num = function (v, d) { return isFinite(Number(v)) ? Number(v) : d; };
    const s = {
        id: ++shapeSeq, type: source.type, color: String(source.color || state.main),
        name: source.name ? String(source.name) + " 복사" : "",
        w: num(source.w, 100), h: num(source.h, 100),
        x: num(source.x, 0) + 20, y: num(source.y, 0) + 20,
        stroke: num(source.stroke, 0), radius: num(source.radius, 0)
    };
    if (s.type === "text") {
        s.text = String(source.text || "");
        s.size = num(source.size, 26);
        s.weight = num(source.weight, 400);
    }
    if (Array.isArray(source.points)) {
        s.points = source.points.map(function (pt) { return [num(pt[0], 0), num(pt[1], 0)]; });
    }
    if (s.x > W - 20 || s.y > H - 20) { s.x = num(source.x, 0); s.y = num(source.y, 0); }
    state.shapes.push(s);
    copied = Object.assign({}, s);
    pasteButton.disabled = false;
    selected = "shape:" + s.id;
    buildShapeList();
    render();
    showToast(shapeTitle(s) + " 붙여넣음");
}

function deleteSelection() {
    const s = shapeOf();
    const row = rowOf(selected);
    if (s) {
        state.shapes.splice(state.shapes.indexOf(s), 1);
        buildShapeList();
    } else if (selected === "logo") {
        removeLogo();
        return;
    } else if (row) {
        if (ROW_LABELS.ko[row.key]) row.value = "";
        else state.rows.splice(state.rows.indexOf(row), 1);
        buildRows();
        showToast("내용을 지웠어요. 왼쪽 칸에 다시 쓰면 돌아와요");
    } else if (FIELD_KEYS.indexOf(selected) >= 0) {
        state[selected] = "";
        syncFieldInputs();
        showToast("내용을 지웠어요. 왼쪽 칸에 다시 쓰면 돌아와요");
    } else {
        return;
    }
    selected = null;
    render();
}

// 고른 객체에만 색 바꾸기 (바꿨으면 true)
function setSelectionColor(color) {
    const s = shapeOf();
    if (s) {
        s.color = color;
        buildShapeList();
    } else if (isTextKey(selected)) {
        (state.styles[selected] || (state.styles[selected] = {})).color = color;
    } else {
        return false;
    }
    render();
    return true;
}

function currentColor() {
    const s = shapeOf();
    if (s) return resolveColor(s.color);
    if (isTextKey(selected)) return textStyle(selected).color;
    return state.main;
}

function buildShapeList() {
    shapeList.replaceChildren();
    state.shapes.forEach(function (s) {
        const item = document.createElement("div");
        item.className = "shape-item" + (selected === "shape:" + s.id ? " active" : "");

        const title = document.createElement("button");
        title.type = "button";
        title.className = "shape-title";
        title.textContent = s.type === "text" ? shapeTitle(s) : shapeTitle(s) + "  " + mm(s.w) + " × " + mm(s.h) + "mm";
        title.addEventListener("click", function () { selectKey("shape:" + s.id); });
        const color = document.createElement("button");
        color.type = "button";
        color.className = "shape-color";
        color.style.background = resolveColor(s.color);
        color.title = "색 바꾸기";
        color.setAttribute("aria-label", shapeTitle(s) + " 색 바꾸기");
        color.addEventListener("click", function () {
            ColorPicker.open(color, s.color, function (c) {
                s.color = c;
                color.style.background = c;
                render();
            });
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "file-remove";
        remove.textContent = "×";
        remove.title = shapeTitle(s) + " 삭제";
        remove.setAttribute("aria-label", remove.title);
        remove.addEventListener("click", function () {
            state.shapes.splice(state.shapes.indexOf(s), 1);
            if (selected === "shape:" + s.id) selected = null;
            buildShapeList();
            render();
        });
        item.append(title, color, remove);
        shapeList.append(item);
    });
}

/* ========== 고른 객체 편집 칸 ========== */

// 설계 단위(0.1mm) → mm 글자
function mm(units) {
    return String(Math.round(units) / 10);
}

function pt(units) {
    return String(Math.round(units * PT_PER_UNIT * 2) / 2);
}

// 크기·위치 입력 한 줄: 이름, −, 숫자, +
function sizeRow(label, get, set, step, min, unit) {
    const row = document.createElement("div");
    row.className = "size-row";
    const name = document.createElement("span");
    name.textContent = label;
    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−";
    minus.setAttribute("aria-label", label + " 줄이기");
    const input = document.createElement("input");
    input.type = "number";
    input.className = "text-input";
    input.step = step;
    input.setAttribute("aria-label", label + " (" + unit + ")");
    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.setAttribute("aria-label", label + " 늘리기");
    const suffix = document.createElement("span");
    suffix.className = "size-unit";
    suffix.textContent = unit;

    function apply(value) {
        if (!isFinite(value)) return;
        if (min !== null) value = Math.max(min, value);
        set(Math.round(value * 1000) / 1000);
        buildShapeList();
        render();
    }
    input.addEventListener("input", function () {
        if (input.value !== "") apply(Number(input.value));
    });
    input.addEventListener("blur", function () { input.value = get(); });
    minus.addEventListener("click", function () { apply(Number(get()) - step); });
    plus.addEventListener("click", function () { apply(Number(get()) + step); });

    row.append(name, minus, input, plus, suffix);
    row.sync = function () {
        if (document.activeElement !== input) input.value = get();
    };
    return row;
}

// 글자 칸·로고의 X·Y (지금 자리에서 원하는 자리로 옮김)
function positionRows(key) {
    return [
        sizeRow("X 위치", function () { const b = boxOf(key); return b ? mm(b.x) : 0; },
            function (v) { const b = boxOf(key); if (b) moveKeyTo(key, v * 10, b.y); }, 1, null, "mm"),
        sizeRow("Y 위치", function () { const b = boxOf(key); return b ? mm(b.y) : 0; },
            function (v) { const b = boxOf(key); if (b) moveKeyTo(key, b.x, v * 10); }, 1, null, "mm")
    ];
}

function buildSizeGrid() {
    sizeGrid.replaceChildren();
    const s = shapeOf();
    let rows = [];
    if (s && s.type === "text") {
        rows.push(
            sizeRow("글자 크기", function () { return pt(s.size); }, function (v) { s.size = Math.max(1, v / PT_PER_UNIT); }, 0.5, 1, "pt"),
            sizeRow("X 위치", function () { return mm(s.x); }, function (v) { s.x = v * 10; }, 1, null, "mm"),
            sizeRow("Y 위치", function () { return mm(s.y); }, function (v) { s.y = v * 10; }, 1, null, "mm")
        );
    } else if (s) {
        const isLine = s.type === "line";
        rows.push(
            sizeRow(isLine ? "길이" : "가로", function () { return mm(s.w); }, function (v) { s.w = v * 10; }, 1, 0.1, "mm"),
            sizeRow(isLine ? "두께" : "세로", function () { return mm(s.h); }, function (v) { s.h = v * 10; }, isLine ? 0.1 : 1, 0.1, "mm"),
            sizeRow("X 위치", function () { return mm(s.x); }, function (v) { s.x = v * 10; }, 1, null, "mm"),
            sizeRow("Y 위치", function () { return mm(s.y); }, function (v) { s.y = v * 10; }, 1, null, "mm")
        );
        if (!isLine) {
            // 0이면 속을 채우고, 0보다 크면 그 굵기의 테두리만
            rows.push(sizeRow(s.type === "polyline" ? "선 굵기" : "테두리", function () { return mm(s.stroke || 0); },
                function (v) { s.stroke = v * 10; }, 0.1, s.type === "polyline" ? 0.1 : 0, "mm"));
        }
        if (s.type === "rect") {
            rows.push(sizeRow("둥글기", function () { return mm(s.radius || 0); },
                function (v) { s.radius = v * 10; }, 0.5, 0, "mm"));
        }
    } else if (selected === "logo") {
        rows.push(sizeRow("크기", function () { return Math.round(state.logoScale * 100); },
            function (v) { setLogoScale(v / 100); }, 10, 10, "%"));
        rows = rows.concat(positionRows("logo"));
    } else if (isTextKey(selected)) {
        const key = selected;
        const base = TEXT_BASE[key.indexOf("row:") === 0 ? "row" : key].size;
        rows.push(sizeRow("글자 크기", function () { return pt(textStyle(key).size); },
            function (v) { setTextScale(key, v / PT_PER_UNIT / base); }, 0.5, 2, "pt"));
        rows = rows.concat(positionRows(key));
    }
    rows.forEach(function (row) { sizeGrid.append(row); });
    sizeGrid.hidden = rows.length === 0;
}

// 고른 글자의 내용 (글자 칸이면 왼쪽 입력칸과 같은 값)
function selectionTextGet() {
    const s = shapeOf();
    if (s) return s.text || "";
    const row = rowOf(selected);
    if (row) return row.value;
    return FIELD_KEYS.indexOf(selected) >= 0 ? state[selected] : "";
}

function selectionTextSet(value) {
    const s = shapeOf();
    const row = rowOf(selected);
    if (s) {
        s.text = value;
        buildShapeList();
    } else if (row) {
        row.value = value;
        const input = rowList.querySelector('input[data-row="' + row.id + '"]');
        if (input) input.value = value;
    } else if (FIELD_KEYS.indexOf(selected) >= 0) {
        state[selected] = value;
        syncFieldInputs();
    }
    render();
}

function syncSelectionBar() {
    const colorable = !!selected && selected !== "logo";
    mainColorNote.hidden = !colorable;
    if (colorable) {
        mainColorNote.textContent = "지금은 고른 '" + keyTitle(selected) + "'에만 적용돼요. 전체 색을 바꾸려면 선택을 해제하세요 (Esc).";
    }

    selectionBar.hidden = !selected;
    if (!selected) {
        barKey = null;
        return;
    }
    const s = shapeOf();
    const textual = isTextKey(selected) || (s && s.type === "text");
    selectionName.textContent = "선택: " + keyTitle(selected);
    selectionColor.hidden = !colorable;
    selectionText.hidden = !textual;
    boldCheckWrap.hidden = !textual;
    if (textual) {
        if (document.activeElement !== selectionTextInput) selectionTextInput.value = selectionTextGet();
        boldCheck.checked = (s ? s.weight || 400 : textStyle(selected).weight) >= 700;
    }
    if (s) {
        colorResetButton.textContent = "기본 색으로";
        colorResetButton.hidden = !s.baseColor || s.color === s.baseColor;
    } else {
        colorResetButton.textContent = "기본 모양으로";
        colorResetButton.hidden = !state.styles[selected] || !Object.keys(state.styles[selected]).length;
    }
    copyButton.disabled = !s && !isTextKey(selected);
    deleteButton.disabled = false;
    markSwatch(selColors, currentColor());

    if (barKey !== selected) {
        barKey = selected;
        buildSizeGrid();
    }
    sizeGrid.querySelectorAll(".size-row").forEach(function (row) { row.sync(); });
}

/* ========== 미리보기에서 고르기·옮기기·크기 바꾸기 ========== */

function toDesign(event) {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * W / rect.width, (event.clientY - rect.top) * H / rect.height];
}

function hitTest(p) {
    // 위에 그려진 것부터 (글자·로고 → 나중에 더한 도형)
    for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i];
        if (b.shape) {
            if (shapeHit(b.shape, p, 8)) return b.key;
        } else if (p[0] >= b.x - 6 && p[0] <= b.x + b.w + 6 && p[1] >= b.y - 4 && p[1] <= b.y + b.h + 4) {
            return b.key;
        }
    }
    return null;
}

// 크기 조절 손잡이: 도형은 8개, 글자·로고는 비율 유지라 모서리 4개
function handlesOf(box) {
    const s = shapeOf(box.key);
    const ids = s && s.type !== "text" ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"] : ["nw", "ne", "se", "sw"];
    return ids.map(function (id) {
        const hx = id.indexOf("w") >= 0 ? box.x : id.indexOf("e") >= 0 ? box.x + box.w : box.x + box.w / 2;
        const hy = id.indexOf("n") >= 0 ? box.y : id.indexOf("s") >= 0 ? box.y + box.h : box.y + box.h / 2;
        return { id: id, x: hx, y: hy };
    });
}

function handleAt(p, event) {
    const box = boxes.find(function (b) { return b.key === selected; });
    if (!box) return null;
    const tol = HANDLE_PX * (event.pointerType === "touch" ? 1.6 : 0.9) * W / canvas.clientWidth;
    return handlesOf(box).find(function (h) {
        return Math.abs(p[0] - h.x) <= tol && Math.abs(p[1] - h.y) <= tol;
    }) || null;
}

function moveSelected(dx, dy) {
    if (!selected) return;
    const s = shapeOf();
    if (s) {
        s.x += dx;
        s.y += dy;
    } else {
        const o = offsetOf(selected);
        state.offsets[selected] = [o[0] + dx, o[1] + dy];
    }
    render();
}

// 끄는 손잡이의 반대쪽 모서리는 그대로 두고 크기 바꾸기 (도형은 Shift로 비율 유지)
function resizeSelected(p, keepRatio) {
    const b = drag.box;
    const id = drag.handle;
    const dx = p[0] - drag.start[0];
    const dy = p[1] - drag.start[1];
    let w = b.w, h = b.h;
    if (id.indexOf("w") >= 0) w = b.w - dx;
    if (id.indexOf("e") >= 0) w = b.w + dx;
    if (id.indexOf("n") >= 0) h = b.h - dy;
    if (id.indexOf("s") >= 0) h = b.h + dy;
    const f = Math.max(0.05, (w / b.w + h / b.h) / 2);

    const s = shapeOf();
    if (s && s.type !== "text") {
        if (keepRatio && id.length === 2) {
            const g = Math.max(w / b.w, h / b.h);
            w = b.w * g;
            h = b.h * g;
        }
        w = Math.max(1, Math.round(w));
        h = Math.max(1, Math.round(h));
        s.w = w;
        s.h = h;
        s.x = id.indexOf("w") >= 0 ? b.x + b.w - w : b.x;
        s.y = id.indexOf("n") >= 0 ? b.y + b.h - h : b.y;
        buildShapeList();
        render();
        return;
    }

    if (s) {
        // 자유 글자: 글자 크기를 바꾸고 칸을 다시 잼
        s.size = Math.max(4, drag.size * f);
        scratch.font = fontOf(s.weight || 400, s.size);
        s.w = Math.max(8, scratch.measureText(s.text || " ").width);
        s.h = s.size * 1.25;
        s.x = id.indexOf("w") >= 0 ? b.x + b.w - s.w : b.x;
        s.y = id.indexOf("n") >= 0 ? b.y + b.h - s.h : b.y;
        render();
        return;
    }

    // 로고·글자 칸: 배율을 바꾸고, 반대쪽 모서리가 제자리에 있게 위치 보정
    if (selected === "logo") setLogoScale(drag.scale * f);
    else setTextScale(selected, drag.scale * f);
    const nb = boxOf(selected);
    if (!nb) return;
    const wantX = id.indexOf("w") >= 0 ? b.x + b.w - nb.w : b.x;
    const wantY = id.indexOf("n") >= 0 ? b.y + b.h - nb.h : b.y;
    const o = offsetOf(selected);
    state.offsets[selected] = [o[0] + wantX - nb.x, o[1] + wantY - nb.y];
    render();
}

function selectKey(key) {
    if (key === selected) return;
    selected = key;
    buildShapeList();
    render();
}

let drag = null;
let cropMode = false;
let cropRect = null;   // 로고 잘라오기 네모 [x0, y0, x1, y1]

function normRect(r) {
    return { x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]) };
}

canvas.addEventListener("pointerdown", function (event) {
    const p = toDesign(event);
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (cropMode) {
        cropRect = [p[0], p[1], p[0], p[1]];
        drag = { mode: "crop" };
        render();
        return;
    }
    const handle = handleAt(p, event);
    if (handle) {
        const s = shapeOf();
        const box = s ? { x: s.x, y: s.y, w: s.w, h: s.h } : Object.assign({}, boxes.find(function (b) { return b.key === selected; }));
        drag = {
            mode: "resize", handle: handle.id, start: p, box: box, size: s ? s.size : 0,
            scale: selected === "logo" ? state.logoScale : isTextKey(selected) ? textStyle(selected).scale : 1
        };
    } else {
        const key = hitTest(p);
        selectKey(key);
        if (!key) {
            canvas.releasePointerCapture(event.pointerId);
            return;
        }
        drag = { mode: "move", last: p };
    }
    canvas.focus({ preventScroll: true });
});
canvas.addEventListener("pointermove", function (event) {
    const p = toDesign(event);
    if (!drag) {
        const handle = cropMode ? null : handleAt(p, event);
        canvas.style.cursor = cropMode ? "crosshair" : handle ? CURSORS[handle.id] : hitTest(p) ? "move" : "default";
        return;
    }
    if (drag.mode === "crop") {
        cropRect[2] = p[0];
        cropRect[3] = p[1];
        render();
    } else if (drag.mode === "resize") {
        resizeSelected(p, event.shiftKey);
    } else {
        moveSelected(p[0] - drag.last[0], p[1] - drag.last[1]);
        drag.last = p;
    }
});
["pointerup", "pointercancel"].forEach(function (type) {
    canvas.addEventListener(type, function () {
        if (drag && drag.mode === "crop") finishCrop();
        drag = null;
    });
});

/* ========== 키보드: 방향키, Delete, Esc, Ctrl+C / Ctrl+V ========== */

function isTyping(el) {
    return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
        if (ColorPicker.isOpen()) { ColorPicker.close(); return; }
        if (cropMode) { setCropMode(false); return; }
    }
    if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") {
        selectKey(null);
        return;
    }
    if (!selected) return;
    const step = event.shiftKey ? 10 : 2;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (move) {
        event.preventDefault();
        moveSelected(move[0], move[1]);
    } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelection();
    }
});

// 복사: 도형·글자를 고른 상태에서 Ctrl+C면 클립보드에
document.addEventListener("copy", function (event) {
    if (!selected || isTyping(document.activeElement) || String(window.getSelection())) return;
    const c = copySelection();
    if (!c || !event.clipboardData) return;
    event.clipboardData.setData("text/plain", CLIP_MARK + JSON.stringify(c));
    event.preventDefault();
});

// 붙여넣기: 클립보드에 복사한 도형이 있으면 도형으로, 그림이면 로고로 (로고 처리는 다음 단계에)
window.addEventListener("paste", function (event) {
    if (isTyping(document.activeElement) || !event.clipboardData) return;
    const data = event.clipboardData;
    const hasImage = Array.from(data.files || []).some(function (f) { return f.type.indexOf("image/") === 0; });
    if (hasImage) return;
    const text = data.getData("text/plain") || "";
    if (text.indexOf(CLIP_MARK) !== 0) return;
    let source = null;
    try {
        source = JSON.parse(text.slice(CLIP_MARK.length));
    } catch (e) { /* 잘못된 내용은 무시 */ }
    event.preventDefault();
    event.stopImmediatePropagation();
    pasteShape(source);
}, true);

copyButton.addEventListener("click", copySelection);
pasteButton.addEventListener("click", function () { pasteShape(copied); });
deleteButton.addEventListener("click", deleteSelection);
document.getElementById("deselectButton").addEventListener("click", function () { selectKey(null); });
colorResetButton.addEventListener("click", function () {
    const s = shapeOf();
    if (s) {
        s.color = s.baseColor; // 양식 장식은 다시 주·보조 색상을 따라감
        buildShapeList();
    } else {
        delete state.styles[selected];
        barKey = null;
    }
    render();
});
selectionTextInput.addEventListener("input", function () { selectionTextSet(selectionTextInput.value); });
boldCheck.addEventListener("change", function () {
    const s = shapeOf();
    const weight = boldCheck.checked ? 700 : 400;
    if (s) s.weight = weight;
    else if (isTextKey(selected)) (state.styles[selected] || (state.styles[selected] = {})).weight = weight;
    render();
});

/* ========== 내 명함 사진으로 시작하기 ========== */

// 글자 인식(Tesseract.js)은 처음 쓸 때만 불러옴. 한글·영어 인식 자료는 처음 한 번 내려받음
const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const REF_W = 1800;  // 펴 둔 명함 사진 크기 (설계 단위의 2배)
const REF_H = 1000;

const importStatus = document.getElementById("importStatus");
const importStatusText = document.getElementById("importStatusText");
const importProgress = document.getElementById("importProgress");
const importOptions = document.getElementById("importOptions");
const importFile = document.getElementById("importFile");
const refShow = document.getElementById("refShow");
const refOpacity = document.getElementById("refOpacity");
const refOpacityValue = document.getElementById("refOpacityValue");
const cropLogoButton = document.getElementById("cropLogoButton");
const cropHelp = document.getElementById("cropHelp");
let importing = false;

function setImportStatus(text, ratio, isError) {
    importStatus.hidden = !text;
    importStatusText.textContent = text || "";
    importStatus.classList.toggle("error", !!isError);
    importProgress.parentElement.hidden = ratio === undefined;
    importProgress.style.width = Math.round((ratio || 0) * 100) + "%";
}

function loadScript(url) {
    return new Promise(function (resolve, reject) {
        if (window.Tesseract) return resolve();
        const script = document.createElement("script");
        script.src = url;
        script.onload = resolve;
        script.onerror = function () {
            script.remove(); // 다음에 다시 시도할 수 있게
            reject(new Error("글자 인식 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요."));
        };
        document.head.append(script);
    });
}

function transparentShare(c) {
    const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let clear = 0, total = 0;
    for (let i = 3; i < data.length; i += 16) {
        total++;
        if (data[i] < 128) clear++;
    }
    return clear / total;
}

// 사진 속 명함을 찾아 반듯하게 펴고 명함 비율(9:5)로 맞춤. 배경과 구분이 안 되면(스캔 등) 사진 그대로
function flattenCard(src) {
    let card = src;
    let note = "";
    try {
        const cut = ImageKit.removeBackgroundColor(src, 40);
        const share = transparentShare(cut);
        if (share > 0.04 && share < 0.85) {
            const flat = ImageKit.straightenRect(src, cut);
            if (flat && flat.width * flat.height > src.width * src.height * 0.15) card = flat;
        }
    } catch (e) { /* 펴지 못하면 그대로 */ }
    if (card.height > card.width * 1.1) note = " 세로형 명함은 가로(90 × 50mm)에 맞춰 만들어요.";
    const out = document.createElement("canvas");
    out.width = REF_W;
    out.height = REF_H;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, REF_W, REF_H);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(card, 0, 0, REF_W, REF_H);
    return { canvas: out, note: note };
}

// 글자 줄(원본 픽셀 좌표)과 장식 덩어리(설계 단위) 찾기. Tesseract는 큰 한글(예: 김 = ㄱ·ㅣ 위, ㅁ 아래)을 위아래 두 줄로 잘라
// 못 읽는 일이 많아서, 잉크 덩어리를 직접 이어 붙여 줄 상자를 만들고 못 읽은 곳은 한 줄씩 다시 읽음
function segmentLines(ref) {
    const SW = 900, SH = 500, K = ref.width / SW;
    const c = document.createElement("canvas");
    c.width = SW;
    c.height = SH;
    const cx = c.getContext("2d");
    cx.drawImage(ref, 0, 0, SW, SH);
    const d = cx.getImageData(0, 0, SW, SH).data;
    const n = SW * SH;
    const ink = new Uint8Array(n);
    for (let p = 0; p < n; p++) ink[p] = 765 - d[p * 4] - d[p * 4 + 1] - d[p * 4 + 2] > 150 ? 1 : 0;

    // 잉크 덩어리. 가장자리에 닿거나 아주 큰 것(띠·테두리)은 글자가 아님
    const seen = new Uint8Array(n);
    const queue = new Int32Array(n);
    let boxes = [];
    const blocks = [];
    for (let start = 0; start < n; start++) {
        if (!ink[start] || seen[start]) continue;
        let head = 0, tail = 0;
        queue[tail++] = start;
        seen[start] = 1;
        let x0 = SW, y0 = SH, x1 = 0, y1 = 0;
        const sum = [0, 0, 0];
        while (head < tail) {
            const p = queue[head++];
            const px = p % SW, py = (p / SW) | 0;
            sum[0] += d[p * 4]; sum[1] += d[p * 4 + 1]; sum[2] += d[p * 4 + 2];
            if (px < x0) x0 = px;
            if (px > x1) x1 = px;
            if (py < y0) y0 = py;
            if (py > y1) y1 = py;
            const around = [px > 0 ? p - 1 : -1, px < SW - 1 ? p + 1 : -1, p - SW, p + SW];
            for (let k = 0; k < 4; k++) {
                const q = around[k];
                if (q >= 0 && q < n && ink[q] && !seen[q]) { seen[q] = 1; queue[tail++] = q; }
            }
        }
        const edge = x0 <= 1 || y0 <= 1 || x1 >= SW - 2 || y1 >= SH - 2;
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        const fill = tail / (bw * bh);
        const color = rgbToHex(sum.map(function (v) { return v / tail; }));
        // 꽉 찬 큰 덩어리는 띠·네모·원 같은 장식 (글자는 이렇게 꽉 차지 않음)
        // 가장자리의 가는 띠는 사진을 펴면서 살짝 사다리꼴이 되기도 해서 덜 꽉 차도 띠로 봄
        if (edge && tail >= n * 0.002 && Math.min(bw, bh) >= 3 && (bw < SW * 0.12 || bh < SH * 0.12) && fill >= 0.45) {
            blocks.push({ type: "rect", x: x0 * W / SW, y: y0 * H / SH, w: bw * W / SW, h: bh * H / SH, color: color });
            continue;
        }
        if (tail >= n * 0.002 && Math.min(bw, bh) >= 4 && fill >= 0.72) {
            const round = fill < 0.84 && Math.abs(bw - bh) < Math.max(bw, bh) * 0.25;
            if (fill >= 0.84 || round) {
                blocks.push({ type: round ? "circle" : "rect", x: x0 * W / SW, y: y0 * H / SH, w: bw * W / SW, h: bh * H / SH, color: color });
                continue;
            }
        }
        if (!edge && x1 - x0 < SW * 0.6 && y1 - y0 < SH * 0.4) boxes.push({ x0: x0, y0: y0, x1: x1 + 1, y1: y1 + 1 });
    }

    // 같은 줄(세로로 겹치고 가로로 가까움)이거나 한 글자의 위아래 조각이면 합치기
    let merged = true;
    while (merged) {
        merged = false;
        for (let i = 0; i < boxes.length && !merged; i++) {
            for (let j = i + 1; j < boxes.length && !merged; j++) {
                const a = boxes[i], b = boxes[j];
                const ha = a.y1 - a.y0, hb = b.y1 - b.y0, hm = Math.max(ha, hb);
                const vOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
                const hGap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
                const sameLine = vOverlap > Math.min(ha, hb) * 0.5 && hGap < hm * 0.6;
                const stacked = hGap < 0 && vOverlap > -hm * 0.12 && Math.min(ha, hb) > hm * 0.15 &&
                    Math.abs(a.x0 + a.x1 - b.x0 - b.x1) < Math.max(a.x1 - a.x0, b.x1 - b.x0) &&
                    Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0) < hm * 2;
                if (sameLine || stacked) {
                    boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
                    boxes.splice(j, 1);
                    merged = true;
                }
            }
        }
    }
    return {
        lines: boxes.filter(function (b) { return b.y1 - b.y0 >= 5 && b.x1 - b.x0 >= 5; })
            .map(function (b) { return { x0: b.x0 * K, y0: b.y0 * K, x1: b.x1 * K, y1: b.y1 * K }; }),
        blocks: blocks
    };
}

function overlapArea(a, b) {
    return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}

// 읽은 줄들 (원본 픽셀 좌표) { lines: [{ conf, words: [{ text, x0, y0, x1, y1 }] }], blocks }
async function recognize(card) {
    await loadScript(TESSERACT_URL);
    const worker = await window.Tesseract.createWorker("kor+eng", 1, {
        logger: function (m) {
            if (m.status === "recognizing text") setImportStatus("글자를 읽는 중", 0.35 + 0.45 * (m.progress || 0));
            else if (/load|download|initializ/i.test(m.status || "")) setImportStatus("글자 인식 준비 중 (처음 한 번은 자료를 내려받아요)", 0.05 + 0.3 * (m.progress || 0));
        }
    });
    try {
        const data = (await worker.recognize(card)).data;
        let lines = (data.lines || []).map(function (line) {
            return {
                conf: line.confidence,
                words: (line.words || []).map(function (w) {
                    return { text: w.text.trim(), conf: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 };
                }).filter(function (w) { return w.text; })
            };
        }).filter(function (l) { return l.words.length; });
        const box = function (l) {
            return {
                x0: Math.min.apply(null, l.words.map(function (w) { return w.x0; })), y0: Math.min.apply(null, l.words.map(function (w) { return w.y0; })),
                x1: Math.max.apply(null, l.words.map(function (w) { return w.x1; })), y1: Math.max.apply(null, l.words.map(function (w) { return w.y1; }))
            };
        };

        // 믿을 만한 줄이 덮지 못한 글자 덩어리는 한 줄 모드로 다시 읽기
        const good = lines.filter(function (l) { return l.conf >= 70; });
        const seg = segmentLines(card);
        const redo = seg.lines.filter(function (b) {
            const area = (b.x1 - b.x0) * (b.y1 - b.y0);
            const covered = good.reduce(function (sum, l) { return sum + overlapArea(b, box(l)); }, 0);
            return covered < area * 0.6;
        });
        if (redo.length) {
            await worker.setParameters({ tessedit_pageseg_mode: "7" });
            for (let i = 0; i < redo.length; i++) {
                setImportStatus("큰 글자를 다시 읽는 중", 0.8 + 0.2 * i / redo.length);
                const b = redo[i];
                const pad = (b.y1 - b.y0) * 0.25;
                // 글자 높이 30~60px 정도가 잘 읽히는데 글꼴마다 달라서 몇 가지 크기로 읽고 가장 믿을 만한 것
                let best = null;
                for (const target of [40, 56, 30]) {
                    const k = target / (b.y1 - b.y0);
                    const crop = document.createElement("canvas");
                    crop.width = Math.max(8, Math.round((b.x1 - b.x0 + pad * 2) * k));
                    crop.height = Math.max(8, Math.round((b.y1 - b.y0 + pad * 2) * k));
                    const cc = crop.getContext("2d");
                    cc.fillStyle = "#ffffff";
                    cc.fillRect(0, 0, crop.width, crop.height);
                    cc.drawImage(card, b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + pad * 2, b.y1 - b.y0 + pad * 2, 0, 0, crop.width, crop.height);
                    const r = (await worker.recognize(crop)).data;
                    if (!best || r.confidence > best.r.confidence) best = { r: r, k: k };
                    if (r.confidence >= 85) break;
                }
                const r = best.r, k = best.k;
                const words = (r.words || []).map(function (w) {
                    return { text: w.text.trim(), conf: w.confidence, x0: w.bbox.x0 / k + b.x0 - pad, y0: b.y0, x1: w.bbox.x1 / k + b.x0 - pad, y1: b.y1 };
                }).filter(function (w) { return w.text && /[0-9A-Za-z가-힣]/.test(w.text); });
                const before = lines.filter(function (l) { return overlapArea(b, box(l)) > 0; });
                const beat = before.every(function (l) { return l.conf < r.confidence; });
                if (r.confidence < 50 || !words.length || !beat) continue;
                // 이 자리에 겹치던 덜 믿을 만한 줄은 버림
                lines = lines.filter(function (l) { return l.conf >= 70 || overlapArea(b, box(l)) < (box(l).x1 - box(l).x0) * (box(l).y1 - box(l).y0) * 0.3; });
                lines.push({ conf: r.confidence, words: words });
            }
        }
        return { lines: lines.filter(function (l) { return l.conf >= 55; }), blocks: seg.blocks };
    } finally {
        await worker.terminate();
    }
}

/* ----- 읽은 글자 나누기 ----- */

const LABEL_RE = /^(tel|t|phone|ph|p|office|o|fax|f|mobile|mob|m|hp|h\.p|cell|c|e-?mail|e|web|w|homepage|home|url|전화|대표전화|대표|팩스|휴대폰|핸드폰|휴대전화|이메일|메일|홈페이지|주소|address|add|a)[.:)]*$/i;
const PHONE_RE = /\+?\(?\d[\d\s().-]{6,}\d/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const WEB_RE = /(https?:\/\/\S+|www\.\S+|\b[\w-]+\.(com|co\.kr|or\.kr|go\.kr|kr|net|org|io)\b\S*)/i;
const ADDR_RE = /(특별시|광역시|특별자치|[가-힣]+(시|도|군|구)(\s|$)|[가-힣\d]+(로|길)\s?\d|\d+\s?(층|호)|번지|[가-힣]+(읍|면)\s|seoul|busan|incheon|daegu|daejeon|gwangju|ulsan|gyeonggi|korea|-ro\b|-gil\b|-gu\b|-si\b|\broad\b|\bstreet\b|\bst\.|\bfloor\b|\bfl\.|\bbldg|building|suite)/i;
const TITLE_RE = /^(대표이사|대표|회장|부회장|사장|부사장|전무|상무|이사|감사|본부장|실장|센터장|소장|원장|국장|부장|차장|과장|대리|주임|사원|팀장|파트장|선임|책임|수석|연구원|매니저|디자이너|엔지니어|변호사|세무사|회계사|건축사|기술사|ceo|cto|cfo|coo|president|vice|director|manager|engineer|designer|consultant|officer|lead|head|researcher|staff|partner|founder|owner|architect|developer|specialist|assistant|executive|senior|junior|chief)[,.]?$/i;
const DEPT_RE = /(팀|본부|사업부|사업본부|연구소|센터|[가-힣]{2,}부|[가-힣]{2,}실|team|dept\.?|department|division|lab|group)$/i;
const COMPANY_RE = /(㈜|\(주\)|주식회사|유한회사|재단|협회|조합|\b(co|corp|inc|ltd|llc|company|corporation|group|holdings)\b\.?|건설|산업|그룹|컴퍼니|엔지니어링|디자인|테크|솔루션|은행|병원|법무법인|회계법인|대학교|공사|공단|시청|구청)/i;

// 단어 잇기: 실제로 떨어져 있을 때만 띄어 씀 (Tesseract는 한글을 글자마다 단어로 나누기도 함)
// 줄 안의 틈을 크기순으로 놓고 가장 크게 벌어지는 곳을 기준으로 글자 사이 / 띄어쓰기를 나눔
function joinWords(words) {
    const starts = [];
    let text = "";
    const heights = words.map(function (w) { return w.y1 - w.y0; }).sort(function (a, b) { return a - b; });
    const h = heights[heights.length >> 1] || 1;
    const gaps = words.slice(1).map(function (w, i) { return Math.max(0, w.x0 - words[i].x1); }).sort(function (a, b) { return a - b; });
    let limit = h * 0.2;
    let jump = 0;
    for (let i = 0; i + 1 < gaps.length; i++) {
        const ratio = (gaps[i + 1] + 1) / (gaps[i] + 1);
        if (ratio > jump) { jump = ratio; limit = (gaps[i] + gaps[i + 1]) / 2; }
    }
    if (jump < 1.8) limit = h * 0.2;
    limit = Math.max(limit, h * 0.08);
    words.forEach(function (w, i) {
        const prev = words[i - 1];
        // 한 글자짜리 한글 조각 사이는 글자를 나눠 읽은 것일 때가 많아서 더 넓어야 띄어 씀
        const single = /^[가-힣]$/.test(w.text) || (prev && /^[가-힣]$/.test(prev.text));
        if (prev && w.x0 - prev.x1 > (single ? Math.max(limit, h * 0.45) : limit)) text += " ";
        starts.push(text.length);
        text += w.text;
    });
    return { text: text, starts: starts };
}

function piece(words) {
    return {
        words: words,
        text: joinWords(words).text,
        x0: Math.min.apply(null, words.map(function (w) { return w.x0; })),
        y0: Math.min.apply(null, words.map(function (w) { return w.y0; })),
        x1: Math.max.apply(null, words.map(function (w) { return w.x1; })),
        y1: Math.max.apply(null, words.map(function (w) { return w.y1; }))
    };
}

// 줄에서 글자 위치(문자 번호)로 단어 찾기
function wordAt(starts, index) {
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= index) i++;
    return i;
}

function cleanLabel(text) {
    return text.replace(/^[\s|/·,;]+|[\s|/·,;:]+$/g, "");
}

function phoneKind(label, number, used) {
    if (/fax|팩스|^f\b/i.test(label)) return "fax";
    if (/mob|cell|h\.?p|휴대|핸드|^m\b|^c\b/i.test(label)) return "mobile";
    if (/tel|phone|전화|대표|office|^t\b|^p\b|^o\b/i.test(label)) return "tel";
    const digits = number.replace(/\D/g, "").replace(/^82/, "0");
    if (/^01/.test(digits) && !used.mobile) return "mobile";
    return used.tel ? "fax" : "tel";
}

// 한 줄을 연락처 조각(이메일·전화·웹)과 나머지 글자 조각으로 나눔
function splitLine(words) {
    const joined = joinWords(words);
    const starts = joined.starts;
    const text = joined.text;
    const segs = [];
    const email = EMAIL_RE.exec(text);
    if (email) segs.push({ kind: "email", start: email.index, end: email.index + email[0].length, value: email[0] });
    let m;
    PHONE_RE.lastIndex = 0;
    while ((m = PHONE_RE.exec(text))) {
        const inside = segs.some(function (s) { return m.index < s.end && m.index + m[0].length > s.start; });
        if (!inside && m[0].replace(/\D/g, "").length >= 8) segs.push({ kind: "phone", start: m.index, end: m.index + m[0].length, value: m[0].trim() });
    }
    if (!email) {
        const web = WEB_RE.exec(text);
        if (web) segs.push({ kind: "web", start: web.index, end: web.index + web[0].length, value: web[0] });
    }
    segs.sort(function (a, b) { return a.start - b.start; });

    const contacts = [];
    const rest = [];
    let from = 0;
    segs.forEach(function (seg) {
        const firstWord = wordAt(starts, seg.start);
        const lastWord = wordAt(starts, seg.end - 1);
        // 앞 글자: 짧거나 항목 이름처럼 생겼으면 항목 이름, 길면 다른 내용(예: 주소)
        let labelWords = words.filter(function (w, i) { return starts[i] >= from && i < firstWord; });
        let label = cleanLabel(text.slice(from, seg.start));
        if (label.length > 10 && !LABEL_RE.test(label)) {
            const last = labelWords[labelWords.length - 1];
            if (last && LABEL_RE.test(cleanLabel(last.text))) {
                if (labelWords.length > 1) rest.push(piece(labelWords.slice(0, -1)));
                labelWords = [last];
                label = cleanLabel(last.text);
            } else {
                if (labelWords.length) rest.push(piece(labelWords));
                labelWords = [];
                label = "";
            }
        }
        contacts.push({
            kind: seg.kind, label: label, value: seg.value,
            box: piece(labelWords.concat(words.slice(firstWord, lastWord + 1)))
        });
        from = Math.max(from, starts[lastWord] + words[lastWord].text.length);
    });
    const tail = words.filter(function (w, i) { return starts[i] >= from; });
    if (!segs.length) rest.push(piece(words));
    else if (tail.length) rest.push(piece(tail));
    return { contacts: contacts, rest: rest.filter(function (p) { return p.text.replace(/[^0-9A-Za-z가-힣]/g, "").length; }) };
}

function hasHangul(text) {
    return /[가-힣]/.test(text);
}

// 글자 잉크 높이 → 글꼴 크기, 잉크 위 → 기준선 (글꼴 크기에 대한 비율, Noto Sans KR 기준)
function glyphMetrics(text) {
    const han = hasHangul(text);
    const top = han || /[()[\]{}|]/.test(text) ? 0.82 : /[A-Z0-9bdfhklt]/.test(text) ? 0.73 : 0.53;
    const bottom = /[gjpqy(),@;]/.test(text) ? 0.2 : han ? 0.07 : 0;
    return { height: top + bottom, top: top };
}

// 원본 사진에서 글자의 실제 잉크 자리(설계 단위), 색(가장 진한 쪽), 획 굵기(설계 단위)
function inkOf(refData, box) {
    const k = REF_W / W;
    const x0 = Math.max(0, Math.floor(box.x0 * k) - 2), y0 = Math.max(0, Math.floor(box.y0 * k) - 2);
    const x1 = Math.min(REF_W - 1, Math.ceil(box.x1 * k) + 2), y1 = Math.min(REF_H - 1, Math.ceil(box.y1 * k) + 2);
    const d = refData.data;
    const border = [];
    for (let x = x0; x <= x1; x++) border.push((y0 * REF_W + x) * 4, (y1 * REF_W + x) * 4);
    for (let y = y0; y <= y1; y++) border.push((y * REF_W + x0) * 4, (y * REF_W + x1) * 4);
    const bg = [0, 1, 2].map(function (c) {
        const v = border.map(function (i) { return d[i + c]; }).sort(function (a, b) { return a - b; });
        return v[v.length >> 1];
    });
    const inks = [];
    const runs = [];
    let ix0 = x1, iy0 = y1, ix1 = x0, iy1 = y0;
    for (let y = y0; y <= y1; y++) {
        let run = 0;
        for (let x = x0; x <= x1; x++) {
            const i = (y * REF_W + x) * 4;
            const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
            if (dist > 120) {
                inks.push([dist, d[i], d[i + 1], d[i + 2]]);
                run++;
                if (x < ix0) ix0 = x;
                if (x > ix1) ix1 = x;
                if (y < iy0) iy0 = y;
                if (y > iy1) iy1 = y;
            } else if (run) {
                runs.push(run);
                run = 0;
            }
        }
        if (run) runs.push(run);
    }
    if (!inks.length) return { color: TEXT_COLOR, bounds: box, stroke: 0 };
    inks.sort(function (a, b) { return b[0] - a[0]; });
    const top = inks.slice(0, Math.max(1, Math.round(inks.length * 0.4)));
    const color = [1, 2, 3].map(function (c) { return top.reduce(function (s2, p) { return s2 + p[c]; }, 0) / top.length; });
    runs.sort(function (a, b) { return a - b; });
    return {
        color: rgbToHex(color),
        bounds: { x0: ix0 / k, y0: iy0 / k, x1: (ix1 + 1) / k, y1: (iy1 + 1) / k },
        stroke: (runs[Math.floor(runs.length * 0.35)] || 0) / k // 세로 획(가장 짧은 축)의 굵기
    };
}

// 잉크 높이로 글꼴 크기·굵기 짐작
function fitText(refData, box, text) {
    const ink = inkOf(refData, box);
    const m = glyphMetrics(text);
    const b = ink.bounds;
    const size = Math.max(6, (b.y1 - b.y0) / m.height);
    return { ink: ink, metrics: m, size: size, bold: ink.stroke / size > 0.135, x: b.x0, top: b.y0 };
}

// 사진에서 가장 많이 보이는 뚜렷한 색 두 가지 → 주·보조 색상
function cardColors(refData) {
    const d = refData.data;
    const buckets = new Map();
    for (let i = 0; i < d.length; i += 4 * 3) {
        const hsv = rgbToHsv([d[i], d[i + 1], d[i + 2]]);
        if (hsv[1] < 0.35 || hsv[2] < 0.2 || hsv[2] > 0.97) continue;
        const key = ((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5);
        const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
        buckets.set(key, b);
    }
    const list = Array.from(buckets.values()).filter(function (b) { return b.n > d.length / 4 / 3 * 0.002; })
        .sort(function (a, b) { return b.n - a.n; })
        .map(function (b) { return [b.r / b.n, b.g / b.n, b.b / b.n]; });
    if (!list.length) return null;
    const main = list[0];
    const sub = list.find(function (c) { return Math.abs(c[0] - main[0]) + Math.abs(c[1] - main[1]) + Math.abs(c[2] - main[2]) > 120; });
    return { main: rgbToHex(main), sub: sub ? rgbToHex(sub) : rgbToHex(main.map(function (v) { return v + (255 - v) * 0.6; })) };
}

function readCard(found) {
    const scale = W / REF_W;
    const lines = found.map(function (line) {
        return line.words.filter(function (w) {
            return (w.conf >= 30 || /[0-9A-Za-z가-힣]{2}/.test(w.text)) && /[0-9A-Za-z가-힣@]/.test(w.text);
        }).map(function (w) {
            return { text: w.text, x0: w.x0 * scale, y0: w.y0 * scale, x1: w.x1 * scale, y1: w.y1 * scale };
        });
    }).filter(function (words) { return words.length; })
        .sort(function (a, b) { return a[0].y0 - b[0].y0 || a[0].x0 - b[0].x0; });

    const out = { fields: {}, rows: [], free: [] };
    const used = {};
    let pieces = [];
    lines.forEach(function (words) {
        const r = splitLine(words);
        let prevTel = null;
        r.contacts.forEach(function (c) {
            let key = c.kind === "phone" ? phoneKind(c.label, c.value, used) : c.kind === "email" ? "email" : "extra";
            if (used[key] && key !== "extra") key = "extra";
            used[key] = true;
            const row = { key: key, label: c.label, value: c.value, box: c.box, join: key === "fax" && prevTel !== null };
            if (key === "extra" && !c.label && c.kind === "web") row.label = "";
            out.rows.push(row);
            prevTel = key === "tel" ? row : null;
        });
        pieces = pieces.concat(r.rest);
    });

    // 주소 (두 줄에 걸치면 이어 붙임)
    const addr = pieces.filter(function (p) { return p.text.length >= 8 && ADDR_RE.test(p.text); });
    if (addr.length) {
        addr.sort(function (a, b) { return a.y0 - b.y0; });
        const first = addr[0];
        let label = "";
        let words = first.words;
        if (LABEL_RE.test(cleanLabel(words[0].text)) && /^(주소|address|add|a)/i.test(words[0].text)) {
            label = cleanLabel(words[0].text);
        }
        let value = first.text.slice(label ? words[0].text.length : 0).trim();
        let box = first;
        const second = addr[1];
        if (second && second.y0 - first.y1 < (first.y1 - first.y0) * 1.2) {
            value += " " + second.text;
            pieces.splice(pieces.indexOf(second), 1);
        }
        out.rows.unshift({ key: "address", label: label, value: value, box: box });
        pieces.splice(pieces.indexOf(first), 1);
    }

    // 직급·이름·부서·회사명
    const names = [];
    pieces.slice().forEach(function (p) {
        const titleWords = p.words.filter(function (w) { return TITLE_RE.test(w.text); });
        const others = p.words.filter(function (w) { return !TITLE_RE.test(w.text); });
        if (titleWords.length && !out.fields.title) {
            out.fields.title = piece(titleWords);
            pieces.splice(pieces.indexOf(p), 1);
            if (others.length) pieces.push(piece(others));
        }
    });
    pieces.forEach(function (p) {
        const compact = p.text.replace(/\s/g, "");
        if (COMPANY_RE.test(p.text) || DEPT_RE.test(compact)) return;
        if (/^[가-힣]{2,4}$/.test(compact) || /^[A-Z][A-Za-z-]+( [A-Z][A-Za-z-]+){1,2}$/.test(p.text)) names.push(p);
    });
    if (names.length) {
        names.sort(function (a, b) { return (b.y1 - b.y0) - (a.y1 - a.y0) || (hasHangul(b.text) ? 1 : 0) - (hasHangul(a.text) ? 1 : 0); });
        out.fields.name = names[0];
        out.fields.name.text = hasHangul(names[0].text) && names[0].text.replace(/\s/g, "").length <= 4 ? names[0].text.replace(/\s/g, "") : names[0].text;
        pieces.splice(pieces.indexOf(names[0]), 1);
    }
    const company = pieces.filter(function (p) { return COMPANY_RE.test(p.text); })
        .sort(function (a, b) { return (b.y1 - b.y0) - (a.y1 - a.y0); })[0];
    if (company) {
        out.fields.company = company;
        pieces.splice(pieces.indexOf(company), 1);
    }
    const dept = pieces.find(function (p) { return DEPT_RE.test(p.text.trim()) && p.text.length <= 30; });
    if (dept) {
        out.fields.dept = dept;
        pieces.splice(pieces.indexOf(dept), 1);
    }
    out.free = pieces.filter(function (p) { return p.text.replace(/[^0-9A-Za-z가-힣]/g, "").length >= 2; });
    return out;
}

/* ----- 읽은 내용으로 명함 다시 만들기 ----- */

function applyCard(found, ref, blocks) {
    const refData = ref.getContext("2d").getImageData(0, 0, REF_W, REF_H);

    // 깨끗한 바탕에서 시작
    state.template = "plain";
    state.shapes = [];
    applyTemplateDeco();
    state.offsets = {};
    state.styles = {};
    state.logoSource = null;
    updateLogo();
    showLogoFile();
    selected = null;

    const colors = cardColors(refData);
    if (colors) {
        state.main = colors.main;
        state.sub = colors.sub;
    }

    // 띠·네모·원 같은 장식은 같은 자리·색의 도형으로 (글자 뒤에)
    (blocks || []).forEach(function (b) {
        state.shapes.push({ id: ++shapeSeq, type: b.type, color: b.color, stroke: 0, radius: 0, x: b.x, y: b.y, w: b.w, h: b.h });
    });

    FIELD_KEYS.forEach(function (key) {
        state[key] = found.fields[key] ? found.fields[key].text : "";
    });

    // 연락처 줄: 읽은 순서대로, 없는 기본 항목은 빈 칸으로 뒤에
    const rows = found.rows.map(function (r) {
        const row = newRow(r.key, cleanLabel(r.label), r.value, r.join);
        row.box = r.box;
        return row;
    });
    ["address", "tel", "fax", "mobile", "email"].forEach(function (key) {
        if (!rows.some(function (r) { return r.key === key; })) rows.push(newRow(key, "", "", key === "fax"));
    });
    // 항목 이름이 모두 한글·영어 기본 이름이면 그 언어로, 아니면 읽은 그대로 (직접 입력)
    const named = rows.filter(function (r) { return r.box && r.label; });
    const canon = function (s) { return s.toLowerCase().replace(/[.:\s]/g, ""); };
    const lang = ["ko", "en"].find(function (l) {
        return named.length && named.every(function (r) { return ROW_LABELS[l][r.key] && canon(ROW_LABELS[l][r.key]) === canon(r.label); });
    });
    state.lang = lang || "custom";
    rows.forEach(function (r) {
        if (lang && ROW_LABELS[lang][r.key]) r.label = ROW_LABELS[lang][r.key];
        else if (!lang && !r.box && ROW_LABELS.ko[r.key]) r.label = "";
    });
    state.rows = rows;

    // 글자 크기·색·굵기를 원본에 맞추기
    const targets = [];
    FIELD_KEYS.forEach(function (key) {
        if (found.fields[key]) targets.push({ key: key, box: found.fields[key], text: found.fields[key].text });
    });
    rows.forEach(function (r) {
        if (r.box) targets.push({ key: "row:" + r.id, box: r.box, text: r.box.text });
        delete r.box;
    });
    targets.forEach(function (t) {
        t.fit = fitText(refData, t.box, t.text);
        const base = TEXT_BASE[t.key.indexOf("row:") === 0 ? "row" : t.key];
        state.styles[t.key] = { scale: t.fit.size / base.size, color: t.fit.ink.color, weight: t.fit.bold ? 700 : 400 };
        if (t.key.indexOf("row:") === 0) {
            // 원본처럼: 항목 이름도 같은 굵기, 이름과 내용 사이는 한 칸 정도
            state.styles[t.key].labelWeight = t.fit.bold ? 700 : 400;
            state.styles[t.key].labelGap = 6;
        }
    });
    // 크기를 정한 뒤 자리 맞추기 (글자 잉크의 왼쪽 위를 원본 잉크의 왼쪽 위에)
    targets.forEach(function (t) {
        const b = boxOf(t.key);
        if (!b) return;
        const wantBaseline = t.fit.top + t.fit.metrics.top * b.size;
        state.offsets[t.key] = [t.fit.x - b.x, wantBaseline - b.baseline];
    });

    // 나머지 글자는 자유 글자로 같은 자리에
    found.free.forEach(function (p) {
        const f = fitText(refData, p, p.text);
        state.shapes.push({
            id: ++shapeSeq, type: "text", text: p.text, size: f.size, weight: f.bold ? 700 : 400,
            color: f.ink.color, x: f.x, y: f.top + f.metrics.top * f.size - f.size, w: p.x1 - p.x0, h: f.size * 1.25
        });
    });

    markTemplate();
    markLang();
    syncFieldInputs();
    buildRows();
    buildShapeList();
    markSwatch(document.getElementById("mainColors"), state.main);
    markSwatch(document.getElementById("subColors"), state.sub);
    render();
    return targets.length + found.free.length;
}

async function importCard(file) {
    if (importing) return;
    importing = true;
    setCropMode(false);
    try {
        setImportStatus("사진을 여는 중", 0.02);
        const src = await ImageKit.fileToCanvas(file);
        await ImageKit.nextFrame();
        setImportStatus("명함을 찾아 반듯하게 펴는 중", 0.04);
        await ImageKit.nextFrame();
        const flat = flattenCard(src);
        state.reference = flat.canvas;
        state.refName = file.name || "명함 사진";
        state.refShow = true;
        refShow.checked = true;
        showImportFile();
        render();
        const data = await recognize(flat.canvas);
        const count = applyCard(readCard(data.lines), flat.canvas, data.blocks);
        setImportStatus(count
            ? "글자 " + count + "곳을 읽어 배치했어요. 원본을 겹쳐 보며 위치·크기·색을 다듬고, 로고는 '원본에서 로고 영역 잘라오기'로 가져오세요." + flat.note
            : "글자를 읽지 못했어요. 더 밝고 반듯한 사진으로 다시 해 보세요." + flat.note, undefined, !count);
    } catch (error) {
        console.error(error);
        setImportStatus("명함을 읽지 못했어요. 잠시 뒤 다시 시도해 주세요. (" + ((error && error.message) || error) + ")", undefined, true);
    } finally {
        importing = false;
    }
}

function showImportFile() {
    importOptions.hidden = !state.reference;
    importFile.replaceChildren();
    if (!state.reference) return;
    importFile.append(fileChip(state.refName, function () {
        state.reference = null;
        setCropMode(false);
        setImportStatus("");
        showImportFile();
        render();
    }));
}

function setCropMode(on) {
    cropMode = on && !!state.reference;
    cropRect = null;
    cropHelp.hidden = !cropMode;
    cropLogoButton.textContent = cropMode ? "잘라오기 취소" : "원본에서 로고 영역 잘라오기";
    if (cropMode) {
        selected = null;
        state.refShow = true;
        refShow.checked = true;
    }
    render();
}

// 그린 네모 안의 원본을 로고로 (배경 투명 처리 후 같은 자리·크기에)
function finishCrop() {
    const r = normRect(cropRect);
    setCropMode(false);
    if (r.w < 8 || r.h < 8 || !state.reference) return;
    const k = state.reference.width / W;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(r.w * k));
    c.height = Math.max(1, Math.round(r.h * k));
    c.getContext("2d").drawImage(state.reference, r.x * k, r.y * k, r.w * k, r.h * k, 0, 0, c.width, c.height);
    state.logoSource = c;
    state.logoName = "명함에서 잘라낸 로고";
    showLogoFile();
    updateLogo();
    const t = state.logoTrim;
    setLogoScale(t.h / k / 70);
    state.offsets.logo = [0, 0];
    moveKeyTo("logo", r.x + t.x / k, r.y + t.y / k);
    selected = "logo";
    render();
    showToast("로고를 잘라 왔어요. 겹쳐 있던 글자는 골라서 지우세요");
}

/* ========== 저장 ========== */

function safeName(text) {
    return (text || "명함").trim().replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 30) || "명함";
}

document.getElementById("downloadButton").addEventListener("click", function () {
    const out = document.createElement("canvas");
    out.width = EXPORT_W;
    out.height = EXPORT_H;
    const ctx = out.getContext("2d");
    ctx.setTransform(EXPORT_W / W, 0, 0, EXPORT_H / H, 0, 0);
    drawCard(ctx, state.template, true);
    ImageKit.downloadPng(out, "명함-" + safeName(state.name) + ".png");
});

/* ========== 이벤트 연결 ========== */

ImageKit.setupTheme(document.getElementById("themeSelect"));
ImageKit.setupDropzone(document.getElementById("logoDrop"), document.getElementById("logoInput"), handleLogo);

// 명함 사진 올리기 칸 (로고 칸과 따로: 이 칸에 놓은 파일만 받음)
(function () {
    const zone = document.getElementById("importDrop");
    const input = document.getElementById("importInput");
    function pick(files) {
        const file = Array.from(files || []).find(function (f) { return f.type.indexOf("image/") === 0; });
        if (file) importCard(file);
    }
    input.addEventListener("change", function () {
        pick(input.files);
        input.value = "";
    });
    ["dragenter", "dragover"].forEach(function (type) {
        zone.addEventListener(type, function (event) {
            event.preventDefault();
            zone.classList.add("dragover");
        });
    });
    ["dragleave", "drop"].forEach(function (type) {
        zone.addEventListener(type, function () { zone.classList.remove("dragover"); });
    });
    zone.addEventListener("drop", function (event) {
        event.preventDefault(); // 페이지 전체 놓기(로고)로 넘어가지 않게
        pick(event.dataTransfer.files);
    });
})();

refShow.addEventListener("change", function () {
    state.refShow = refShow.checked;
    render();
});
refOpacity.addEventListener("input", function () {
    state.refOpacity = Number(refOpacity.value) / 100;
    refOpacityValue.textContent = refOpacity.value + "%";
    render();
});
cropLogoButton.addEventListener("click", function () { setCropMode(!cropMode); });

// 색 버튼 채우기 (색상표 버튼 앞에)
[["mainColors", state.main], ["subColors", state.sub], ["selColors", null]].forEach(function (g) {
    const group = document.getElementById(g[0]);
    const more = group.querySelector(".more-colors");
    PALETTE.forEach(function (c) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.value = c[0];
        b.style.setProperty("--swatch", c[0]);
        b.title = c[1];
        b.setAttribute("aria-label", c[1]);
        if (c[0] === g[1]) b.classList.add("active");
        group.insertBefore(b, more);
    });
});

setupSwatches(document.getElementById("mainColors"), document.getElementById("mainCustom"),
    function () { return isTextKey(selected) || shapeOf() ? currentColor() : state.main; },
    function (color) {
        // 객체를 골라 둔 상태면 그 객체만 바꾸기
        if (setSelectionColor(color)) return false;
        state.main = color;
        render();
    });
setupSwatches(document.getElementById("subColors"), document.getElementById("subCustom"),
    function () { return state.sub; },
    function (color) {
        state.sub = color;
        render();
    });
setupSwatches(selColors, document.getElementById("selCustom"), currentColor, setSelectionColor);

ImageKit.setupSegmented(document.getElementById("fontSelect"), function (value) {
    state.font = value;
    render();
});
ImageKit.setupSegmented(document.getElementById("langSelect"), setLang);

document.getElementById("shapeAdd").addEventListener("click", function (event) {
    const target = event.target.closest("button");
    if (target) addShape(target.dataset.value);
});

document.getElementById("addRow").addEventListener("click", function () {
    state.rows.push(newRow("extra", state.lang === "en" ? "Web" : state.lang === "ko" ? "홈페이지" : "", ""));
    buildRows();
    const inputs = rowList.querySelectorAll(".info-row:last-child input");
    if (inputs.length) inputs[inputs.length - 1].focus();
});

document.getElementById("resetLayout").addEventListener("click", function () {
    state.offsets = {};
    if (shapeOf() && shapeOf().deco) selected = null;
    applyTemplateDeco();
    buildShapeList();
    render();
});

logoClear.addEventListener("change", updateLogo);
logoSize.addEventListener("input", function () {
    setLogoScale(Number(logoSize.value) / 100);
});

FIELD_KEYS.forEach(bindText);
buildRows();
applyTemplateDeco();
buildShapeList();
buildTemplateGrid();
window.addEventListener("resize", render);
render();
