// 명함 만들기: 양식·로고·내용을 고르면 90 × 50mm 명함을 그려서 PNG로 저장

const W = 900;              // 명함 설계 단위 (1 = 0.1mm)
const H = 500;
const EXPORT_W = 1063;      // 300dpi 기준 90mm
const EXPORT_H = 591;       //               50mm
const TEXT_COLOR = "#1b1d22";
const SUB_TEXT_COLOR = "#5b616b";

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

// 색 고르기 버튼 (진한 색 → 밝은 색)
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
    // 연락처 줄. 팩스는 전화와 같은 줄에 이어 씀 (join)
    rows: [
        { key: "address", label: "주소", value: SAMPLES.ko.address },
        { key: "tel", label: "전화", value: SAMPLES.ko.tel },
        { key: "fax", label: "팩스", value: SAMPLES.ko.fax, join: true },
        { key: "mobile", label: "휴대폰", value: SAMPLES.ko.mobile },
        { key: "email", label: "이메일", value: SAMPLES.ko.email }
    ],
    logoSource: null,   // 올린 그대로
    logo: null,         // 화면에 쓰는 로고 (투명 처리 후)
    logoName: "",
    logoScale: 1,
    offsets: {},        // 끌어서 옮긴 거리 { logo: [dx, dy], ... }
    textColors: {},     // 고른 글자 묶음만 바꾼 색 { company: "#...", name, info }
    shapes: []          // 사용자 도형 { id, type, color, x, y, w, h }
};

let selected = null;   // 미리보기에서 고른 요소 ("logo", "company", "name", "info", "shape:3")
let boxes = [];        // 마지막으로 그린 요소들의 자리 (끌기용)
let shapeSeq = 0;

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

// 글자 조각들 [{ text, weight, size, color, gap }]을 한 줄로 그릴 때의 너비
function measureLine(ctx, parts, k) {
    let width = 0;
    parts.forEach(function (p) {
        ctx.font = fontOf(p.weight, p.size * k);
        width += Math.max(ctx.measureText(p.text).width, (p.minWidth || 0) * k) + (p.gap || 0) * k;
    });
    return width;
}

// 너무 길면 maxWidth에 맞게 글자를 줄임 (최대 55%까지)
function fitScale(ctx, parts, maxWidth) {
    const width = measureLine(ctx, parts, 1);
    return width > maxWidth ? Math.max(0.55, maxWidth / width) : 1;
}

function drawLine(ctx, parts, x, y, align, k) {
    const width = measureLine(ctx, parts, k);
    let cx = align === "left" ? x : align === "right" ? x - width : x - width / 2;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    parts.forEach(function (p) {
        ctx.font = fontOf(p.weight, p.size * k);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, cx, y);
        cx += Math.max(ctx.measureText(p.text).width, (p.minWidth || 0) * k) + (p.gap || 0) * k;
    });
    return { x: align === "left" ? x : align === "right" ? x - width : x - width / 2, w: width };
}

// 여러 줄 블록: 줄마다 [parts, 줄 높이]. top 기준으로 그리고 자리(box)를 돌려줌
function drawBlock(ctx, lines, x, top, align, maxWidth) {
    let k = 1;
    lines.forEach(function (line) { k = Math.min(k, fitScale(ctx, line.parts, maxWidth)); });
    let y = top;
    let minX = Infinity, maxX = -Infinity;
    lines.forEach(function (line) {
        y += line.height * k;
        const r = drawLine(ctx, line.parts, x, y - line.descent * k, align, k);
        minX = Math.min(minX, r.x);
        maxX = Math.max(maxX, r.x + r.w);
    });
    return { x: minX, y: top, w: maxX - minX, h: y - top };
}

function blockHeight(ctx, lines, maxWidth) {
    let k = 1;
    lines.forEach(function (line) { k = Math.min(k, fitScale(ctx, line.parts, maxWidth)); });
    return lines.reduce(function (sum, line) { return sum + line.height * k; }, 0);
}

function offsetOf(key) {
    return state.offsets[key] || [0, 0];
}

function labelOf(row) {
    return row.label ? row.label.trim() : "";
}

// 연락처 줄 만들기: 팩스처럼 join인 항목은 앞 줄에 이어 붙임
// 왼쪽 정렬이면 줄 맨 앞 항목 이름의 너비를 맞춰서 내용이 세로로 가지런하게
function infoLines(ctx, align) {
    const lines = [];
    let labelWidth = 0;
    if (align === "left") {
        ctx.font = fontOf(700, 19);
        state.rows.forEach(function (row) {
            if (row.value.trim() && labelOf(row)) {
                labelWidth = Math.max(labelWidth, ctx.measureText(labelOf(row)).width);
            }
        });
    }
    state.rows.forEach(function (row) {
        const value = row.value.trim();
        if (!value) return;
        const parts = [];
        const label = labelOf(row);
        const last = lines[lines.length - 1];
        const joining = row.join && last && last.key === "tel";
        const own = state.textColors.info;
        if (joining) parts.push({ text: "", weight: 400, size: 19, color: TEXT_COLOR, gap: 26 });
        if (label) parts.push({ text: label, weight: 700, size: 19, color: own || state.main, gap: 12, minWidth: joining ? 0 : labelWidth });
        parts.push({ text: value, weight: 400, size: 19, color: own || TEXT_COLOR });
        if (joining) {
            last.parts = last.parts.concat(parts);
            last.key = "joined";
        } else {
            lines.push({ key: row.key, parts: parts, height: 30, descent: 8 });
        }
    });
    return lines;
}

function nameLines() {
    const lines = [];
    const own = state.textColors.name;
    if (state.dept.trim()) {
        lines.push({ parts: [{ text: state.dept.trim(), weight: 400, size: 21, color: own || SUB_TEXT_COLOR }], height: 34, descent: 8 });
    }
    const nameParts = [];
    if (state.name.trim()) nameParts.push({ text: state.name.trim(), weight: 700, size: 50, color: own || TEXT_COLOR, gap: 14 });
    if (state.title.trim()) nameParts.push({ text: state.title.trim(), weight: 400, size: 24, color: own || SUB_TEXT_COLOR });
    if (nameParts.length) lines.push({ parts: nameParts, height: 62, descent: 12 });
    return lines;
}

function resolveColor(c) {
    return c === "main" ? state.main : c === "sub" ? state.sub : c;
}

function shapePoints(s) {
    if (s.points) return s.points;
    if (s.type === "triangle") return [[0.5, 0], [1, 1], [0, 1]];
    return null;
}

function drawShape(ctx, s) {
    const color = resolveColor(s.color);
    const stroke = s.type === "line" ? 0 : s.stroke || 0;
    ctx.save();
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
    const stroke = s.type === "line" ? 0 : s.stroke || 0;
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
        const maxLogoW = maxWidth * 0.75;
        if (logoW > maxLogoW) { logoH *= maxLogoW / logoW; logoW = maxLogoW; }
        const lx = (align === "left" ? x0 : align === "right" ? x1 - logoW : ax - logoW / 2) + off("logo")[0];
        const ly = y0 + off("logo")[1];
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(state.logo, lx, ly, logoW, logoH);
        found.push({ key: "logo", x: lx, y: ly, w: logoW, h: logoH });
        headBottom = y0 + logoH;
    }

    if (state.company.trim()) {
        const parts = [{ text: state.company.trim(), weight: 700, size: 32, color: state.textColors.company || state.main }];
        let cx = ax, top, room = maxWidth;
        if (state.logo && align !== "center") {
            // 로고 옆에, 로고 높이의 가운데에
            cx = align === "left" ? x0 + logoW + 18 : x1 - logoW - 18;
            room = maxWidth - logoW - 18;
            top = y0 + Math.max(0, (logoH - 44) / 2);
        } else {
            top = state.logo ? headBottom + 8 : y0;
        }
        const lines = [{ parts: parts, height: 44, descent: 10 }];
        room = Math.max(room, 120);
        const h = blockHeight(ctx, lines, room);
        const r = drawBlock(ctx, lines, cx + off("company")[0], top + off("company")[1], align, room);
        found.push({ key: "company", x: r.x, y: r.y, w: r.w, h: h });
        headBottom = Math.max(headBottom, top + h);
    }

    // 연락처: 아래에서부터
    const info = infoLines(ctx, align);
    let infoTop = y1;
    if (info.length) {
        const h = blockHeight(ctx, info, maxWidth);
        infoTop = y1 - h;
        const r = drawBlock(ctx, info, ax + off("info")[0], infoTop + off("info")[1], align, maxWidth);
        found.push({ key: "info", x: r.x, y: r.y, w: r.w, h: r.h });
    }

    // 이름: 머리와 연락처 사이 가운데
    const names = nameLines();
    if (names.length) {
        const h = blockHeight(ctx, names, maxWidth);
        const top = headBottom + Math.max(10, (infoTop - headBottom - h) / 2 - 6);
        const r = drawBlock(ctx, names, ax + off("name")[0], top + off("name")[1], align, maxWidth);
        found.push({ key: "name", x: r.x, y: r.y, w: r.w, h: r.h });
    }

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
        .concat(state.rows.map(function (r) { return r.label + r.value; })).join("");
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

    // 고른 요소 표시와 크기 조절 손잡이 (저장되는 그림에는 안 들어감)
    const box = boxes.find(function (b) { return b.key === selected; });
    if (box) {
        const px = W / canvas.clientWidth; // 화면 1px의 설계 단위
        const handles = handlesOf(box);
        const pad = handles.length ? 0 : 6;
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

function buildTemplateGrid() {
    TEMPLATES.forEach(function (t) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "template" + (t.id === state.template ? " active" : "");
        button.dataset.value = t.id;
        button.setAttribute("aria-pressed", t.id === state.template);
        const c = document.createElement("canvas");
        c.width = 360;
        c.height = 200;
        c.dataset.template = t.id;
        const name = document.createElement("span");
        name.textContent = t.name;
        button.append(c, name);
        templateGrid.append(button);
    });
    templateGrid.addEventListener("click", function (event) {
        const target = event.target.closest("button");
        if (!target) return;
        state.template = target.dataset.value;
        state.offsets = {}; // 양식마다 자리가 달라서 옮긴 위치는 처음대로
        if (shapeOf() && shapeOf().deco) selected = null;
        applyTemplateDeco();
        buildShapeList();
        templateGrid.querySelectorAll("button").forEach(function (b) {
            b.classList.toggle("active", b === target);
            b.setAttribute("aria-pressed", b === target);
        });
        render();
    });
}

// 색 고르기: 미리 정한 색 버튼 + 직접 고르기
function setupSwatches(group, picker, onChange) {
    function select(el) {
        group.querySelectorAll("button, input").forEach(function (b) {
            b.classList.toggle("active", b === el);
        });
    }
    // onChange가 false를 돌려주면 (고른 객체에만 적용) 이 줄의 선택 표시는 그대로
    group.addEventListener("click", function (event) {
        const target = event.target.closest("button");
        if (!target) return;
        if (onChange(target.dataset.value) !== false) select(target);
    });
    picker.addEventListener("input", function () {
        if (onChange(picker.value) !== false) select(picker);
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

function buildRows() {
    rowList.replaceChildren();
    state.rows.forEach(function (row, i) {
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
        value.type = "text";
        value.className = "text-input";
        value.value = row.value;
        value.setAttribute("aria-label", (row.label || "추가 항목") + " 내용");
        if (row.key === "email") value.type = "email";
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
                state.rows.splice(i, 1);
                buildRows();
                render();
            });
            line.append(remove);
            line.classList.add("removable");
        }
        rowList.append(line);
    });
}

function setLang(lang) {
    const before = state.lang;
    state.lang = lang;
    langHelp.textContent = LANG_HELP[lang];

    if (lang !== "custom") {
        // 기본 항목 이름을 언어에 맞게
        state.rows.forEach(function (row) {
            if (ROW_LABELS[lang][row.key]) row.label = ROW_LABELS[lang][row.key];
        });
        // 예시 그대로인 칸은 그 언어의 예시로 바꿔 줌
        const from = before === "custom" ? null : SAMPLES[before];
        if (from && from !== SAMPLES[lang]) {
            ["company", "name", "title", "dept"].forEach(function (key) {
                if (state[key] === from[key]) {
                    state[key] = SAMPLES[lang][key];
                    document.getElementById(key).value = state[key];
                }
            });
            state.rows.forEach(function (row) {
                if (from[row.key] && row.value === from[row.key]) row.value = SAMPLES[lang][row.key];
            });
        }
    }
    buildRows();
    render();
}

/* ========== 로고 ========== */

function updateLogo() {
    if (!state.logoSource) {
        state.logo = null;
    } else if (logoClear.checked) {
        const cut = ImageKit.removeBackgroundColor(state.logoSource, 40);
        state.logo = ImageKit.trimTransparent(cut, 0) || state.logoSource;
    } else {
        state.logo = state.logoSource;
    }
    render();
}

function showLogoFile() {
    logoFile.replaceChildren();
    logoFile.hidden = !state.logoSource;
    logoOptions.hidden = !state.logoSource;
    if (!state.logoSource) return;
    const chip = document.createElement("span");
    chip.className = "file-chip";
    const name = document.createElement("span");
    name.textContent = state.logoName;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "file-remove";
    remove.textContent = "×";
    remove.title = state.logoName + " 삭제";
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", removeLogo);
    chip.append(name, remove);
    logoFile.append(chip);
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

/* ========== 도형 ========== */

const SHAPE_NAMES = { rect: "사각형", circle: "원", line: "선", triangle: "삼각형", poly: "다각형", polyline: "꺾은선" };
const TEXT_NAMES = { logo: "로고", company: "회사명", name: "이름·직급·부서", info: "연락처" };
const HANDLE_PX = 10;            // 크기 조절 손잡이 크기 (화면 px)
const CLIP_MARK = "명함도형:";   // 클립보드에 넣는 도형 표시
const CURSORS = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

const selectionBar = document.getElementById("selectionBar");
const selectionName = document.getElementById("selectionName");
const selectionColor = document.getElementById("selectionColor");
const selColors = document.getElementById("selColors");
const selCustom = document.getElementById("selCustom");
const colorResetButton = document.getElementById("colorResetButton");
const sizeGrid = document.getElementById("sizeGrid");
const copyButton = document.getElementById("copyButton");
const pasteButton = document.getElementById("pasteButton");
const deleteButton = document.getElementById("deleteButton");
const mainColorNote = document.getElementById("mainColorNote");
const toast = document.getElementById("toast");

let copied = null;     // 복사한 도형
let barKey = null;     // 크기 입력칸을 만든 대상 (바뀔 때만 다시 만들기)

function shapeOf(key) {
    key = key || selected;
    if (!key || key.indexOf("shape:") !== 0) return null;
    return state.shapes.find(function (s) { return "shape:" + s.id === key; }) || null;
}

function shapeTitle(s) {
    if (s.name) return s.name;
    const own = state.shapes.filter(function (sh) { return !sh.deco && !sh.name; });
    return SHAPE_NAMES[s.type] + " " + (own.indexOf(s) + 1);
}

function selectedTitle() {
    const s = shapeOf();
    return s ? shapeTitle(s) : TEXT_NAMES[selected] || "";
}

function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { toast.hidden = true; }, 1600);
}

function addShape(type) {
    const size = {
        rect: [200, 100], circle: [100, 100], line: [300, 6], triangle: [120, 100]
    }[type];
    const s = {
        id: ++shapeSeq, type: type, color: state.main,
        w: size[0], h: size[1], x: Math.round((W - size[0]) / 2), y: Math.round((H - size[1]) / 2)
    };
    state.shapes.push(s);
    selected = "shape:" + s.id;
    buildShapeList();
    render();
}

function copySelection() {
    const s = shapeOf();
    if (!s) {
        showToast("도형만 복사할 수 있어요");
        return null;
    }
    copied = Object.assign({}, s);
    pasteButton.disabled = false;
    showToast(shapeTitle(s) + " 복사함");
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
    if (s) {
        state.shapes.splice(state.shapes.indexOf(s), 1);
        selected = null;
        buildShapeList();
        render();
    } else if (selected === "logo") {
        removeLogo();
    }
}

// 고른 객체에만 색 바꾸기 (바꿨으면 true)
function setSelectionColor(color) {
    const s = shapeOf();
    if (s) {
        s.color = color;
        buildShapeList();
    } else if (selected && selected !== "logo" && TEXT_NAMES[selected]) {
        state.textColors[selected] = color;
    } else {
        return false;
    }
    render();
    return true;
}

function setLogoScale(scale) {
    state.logoScale = Math.min(2.5, Math.max(0.3, scale));
    logoSize.value = Math.round(state.logoScale * 100);
    logoSizeValue.textContent = logoSize.value + "%";
    render();
}

function buildShapeList() {
    shapeList.replaceChildren();
    state.shapes.forEach(function (s) {
        const item = document.createElement("div");
        item.className = "shape-item" + (selected === "shape:" + s.id ? " active" : "");

        const title = document.createElement("button");
        title.type = "button";
        title.className = "shape-title";
        title.textContent = shapeTitle(s) + "  " + mm(s.w) + " × " + mm(s.h) + "mm";
        title.addEventListener("click", function () { selectKey("shape:" + s.id); });
        const color = document.createElement("input");
        color.type = "color";
        color.value = resolveColor(s.color);
        color.setAttribute("aria-label", shapeTitle(s) + " 색");
        color.addEventListener("input", function () { s.color = color.value; render(); });
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

// 크기·위치 입력 한 줄: 이름, −, 숫자(mm), +
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

function buildSizeGrid() {
    sizeGrid.replaceChildren();
    const s = shapeOf();
    const rows = [];
    if (s) {
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
            function (v) { setLogoScale(v / 100); }, 10, 30, "%"));
    }
    rows.forEach(function (row) { sizeGrid.append(row); });
    sizeGrid.hidden = rows.length === 0;
}

function currentColor() {
    const s = shapeOf();
    if (s) return resolveColor(s.color);
    if (selected === "company") return state.textColors.company || state.main;
    return state.textColors[selected] || (selected === "info" ? state.main : TEXT_COLOR);
}

function syncSelectionBar() {
    const colorable = !!selected && selected !== "logo";
    mainColorNote.hidden = !colorable;
    if (colorable) {
        mainColorNote.textContent = "지금은 고른 '" + selectedTitle() + "'에만 적용돼요. 전체 색을 바꾸려면 선택을 해제하세요 (Esc).";
    }

    selectionBar.hidden = !selected;
    if (!selected) {
        barKey = null;
        return;
    }
    const s = shapeOf();
    selectionName.textContent = "선택: " + selectedTitle();
    selectionColor.hidden = !colorable;
    colorResetButton.hidden = s ? !s.baseColor || s.color === s.baseColor : !state.textColors[selected];
    copyButton.disabled = !s;
    deleteButton.disabled = !s && selected !== "logo";

    const color = currentColor().toLowerCase();
    let matched = false;
    selColors.querySelectorAll("button").forEach(function (b) {
        const on = b.dataset.value.toLowerCase() === color;
        b.classList.toggle("active", on);
        if (on) matched = true;
    });
    selCustom.classList.toggle("active", !matched);
    if (!matched && /^#[0-9a-f]{6}$/.test(color)) selCustom.value = color;

    if (barKey !== selected) {
        barKey = selected;
        buildSizeGrid();
    }
    sizeGrid.querySelectorAll(".size-row").forEach(function (row) { row.sync(); });
}

/* ========== 미리보기에서 고르기·옮기기·크기 바꾸기 ========== */

// 어디서든 같은 배치로 계산하려고 쓰는 작은 캔버스
const scratch = document.createElement("canvas").getContext("2d");
function layoutBoxes() {
    return drawCard(scratch, state.template, true);
}

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
        } else if (p[0] >= b.x - 8 && p[0] <= b.x + b.w + 8 && p[1] >= b.y - 8 && p[1] <= b.y + b.h + 8) {
            return b.key;
        }
    }
    return null;
}

// 크기 조절 손잡이: 도형은 8개, 로고는 비율 유지라 모서리 4개
function handlesOf(box) {
    const s = shapeOf(box.key);
    if (!s && box.key !== "logo") return [];
    const ids = s ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"] : ["nw", "ne", "se", "sw"];
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

// 끄는 손잡이의 반대쪽 모서리는 그대로 두고 크기 바꾸기 (Shift: 비율 유지)
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

    const s = shapeOf();
    if (s) {
        if (keepRatio && id.length === 2) {
            const f = Math.max(w / b.w, h / b.h);
            w = b.w * f;
            h = b.h * f;
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

    // 로고: 비율 유지, 반대쪽 모서리가 제자리에 있게 위치 보정
    setLogoScale(drag.scale * (w / b.w + h / b.h) / 2);
    const nb = layoutBoxes().find(function (x) { return x.key === "logo"; });
    if (!nb) return;
    const wantX = id.indexOf("w") >= 0 ? b.x + b.w - nb.w : b.x;
    const wantY = id.indexOf("n") >= 0 ? b.y + b.h - nb.h : b.y;
    const o = offsetOf("logo");
    state.offsets.logo = [o[0] + wantX - nb.x, o[1] + wantY - nb.y];
    render();
}

function selectKey(key) {
    if (key === selected) return;
    selected = key;
    buildShapeList();
    render();
}

let drag = null;

canvas.addEventListener("pointerdown", function (event) {
    const p = toDesign(event);
    const handle = handleAt(p, event);
    if (handle) {
        const s = shapeOf();
        const box = s ? { x: s.x, y: s.y, w: s.w, h: s.h } : Object.assign({}, boxes.find(function (b) { return b.key === selected; }));
        drag = { mode: "resize", handle: handle.id, start: p, box: box, scale: state.logoScale };
    } else {
        const key = hitTest(p);
        selectKey(key);
        if (!key) return;
        drag = { mode: "move", last: p };
    }
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
});
canvas.addEventListener("pointermove", function (event) {
    const p = toDesign(event);
    if (!drag) {
        const handle = handleAt(p, event);
        canvas.style.cursor = handle ? CURSORS[handle.id] : hitTest(p) ? "move" : "default";
        return;
    }
    if (drag.mode === "resize") {
        resizeSelected(p, event.shiftKey);
    } else {
        moveSelected(p[0] - drag.last[0], p[1] - drag.last[1]);
        drag.last = p;
    }
});
["pointerup", "pointercancel"].forEach(function (type) {
    canvas.addEventListener(type, function () { drag = null; });
});

/* ========== 키보드: 방향키, Delete, Esc, Ctrl+C / Ctrl+V ========== */

function isTyping(el) {
    return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

document.addEventListener("keydown", function (event) {
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
    } else if ((event.key === "Delete" || event.key === "Backspace") && (shapeOf() || selected === "logo")) {
        event.preventDefault();
        deleteSelection();
    }
});

// 복사: 도형을 고른 상태에서 Ctrl+C면 그 도형을 클립보드에
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
        delete state.textColors[selected];
    }
    render();
});

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

// 색 버튼 채우기 (직접 고르기 칸 앞에)
[["mainColors", state.main], ["subColors", state.sub], ["selColors", null]].forEach(function (g) {
    const group = document.getElementById(g[0]);
    const picker = group.querySelector("input");
    PALETTE.forEach(function (c) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.value = c[0];
        b.style.setProperty("--swatch", c[0]);
        b.title = c[1];
        b.setAttribute("aria-label", c[1]);
        if (c[0] === g[1]) b.classList.add("active");
        group.insertBefore(b, picker);
    });
});

ImageKit.setupTheme(document.getElementById("themeSelect"));
ImageKit.setupDropzone(document.getElementById("logoDrop"), document.getElementById("logoInput"), handleLogo);

setupSwatches(document.getElementById("mainColors"), document.getElementById("mainCustom"), function (color) {
    // 객체를 골라 둔 상태면 그 객체만 바꾸기
    if (setSelectionColor(color)) return false;
    state.main = color;
    render();
});
setupSwatches(selColors, selCustom, setSelectionColor);
setupSwatches(document.getElementById("subColors"), document.getElementById("subCustom"), function (color) {
    state.sub = color;
    render();
});

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
    state.rows.push({ key: "extra", label: state.lang === "en" ? "Web" : "홈페이지", value: "" });
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

["company", "name", "title", "dept"].forEach(bindText);
buildRows();
applyTemplateDeco();
buildShapeList();
buildTemplateGrid();
window.addEventListener("resize", render);
render();
