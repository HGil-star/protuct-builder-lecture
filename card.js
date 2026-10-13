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

/* ========== 상태 ========== */

const state = {
    template: "line",
    main: "#1f3a8a",
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

// pad: 글자를 놓을 안쪽 여백 [위, 오른쪽, 아래, 왼쪽], align: 글자 정렬
const TEMPLATES = [
    {
        id: "plain", name: "기본", align: "left", pad: [60, 60, 56, 64],
        draw: function () {}
    },
    {
        id: "line", name: "얇은 테두리", align: "left", pad: [62, 64, 58, 66],
        draw: function (ctx, c) {
            ctx.strokeStyle = c.main;
            ctx.lineWidth = 3;
            ctx.strokeRect(22, 22, W - 44, H - 44);
        }
    },
    {
        id: "double", name: "이중 테두리", align: "left", pad: [66, 70, 62, 72],
        draw: function (ctx, c) {
            ctx.strokeStyle = c.main;
            ctx.lineWidth = 5;
            ctx.strokeRect(16, 16, W - 32, H - 32);
            ctx.strokeStyle = c.sub;
            ctx.lineWidth = 2;
            ctx.strokeRect(30, 30, W - 60, H - 60);
        }
    },
    {
        id: "rounded", name: "둥근 테두리", align: "left", pad: [64, 66, 60, 68],
        draw: function (ctx, c) {
            ctx.strokeStyle = c.main;
            ctx.lineWidth = 4;
            roundRectPath(ctx, 22, 22, W - 44, H - 44, 36);
            ctx.stroke();
        }
    },
    {
        id: "leftbar", name: "왼쪽 띠", align: "left", pad: [58, 60, 54, 92],
        draw: function (ctx, c) {
            ctx.fillStyle = c.main;
            ctx.fillRect(0, 0, 30, H);
            ctx.fillStyle = c.sub;
            ctx.fillRect(30, 0, 9, H);
        }
    },
    {
        id: "bottomband", name: "아래 띠", align: "left", pad: [50, 60, 82, 64],
        draw: function (ctx, c) {
            ctx.fillStyle = c.sub;
            ctx.fillRect(0, H - 46, W, 8);
            ctx.fillStyle = c.main;
            ctx.fillRect(0, H - 38, W, 38);
        }
    },
    {
        id: "topbottom", name: "위·아래 선", align: "left", pad: [60, 60, 56, 64],
        draw: function (ctx, c) {
            ctx.fillStyle = c.main;
            ctx.fillRect(0, 0, W, 14);
            ctx.fillRect(0, H - 14, W, 14);
            ctx.fillStyle = c.sub;
            ctx.fillRect(0, 14, W, 4);
            ctx.fillRect(0, H - 18, W, 4);
        }
    },
    {
        id: "corners", name: "모서리 장식", align: "left", pad: [64, 66, 60, 68],
        draw: function (ctx, c) {
            const m = 24, len = 72;
            ctx.strokeStyle = c.main;
            ctx.lineWidth = 5;
            ctx.lineCap = "square";
            [[m, m, 1, 1], [W - m, m, -1, 1], [W - m, H - m, -1, -1], [m, H - m, 1, -1]].forEach(function (p) {
                ctx.beginPath();
                ctx.moveTo(p[0] + len * p[2], p[1]);
                ctx.lineTo(p[0], p[1]);
                ctx.lineTo(p[0], p[1] + len * p[3]);
                ctx.stroke();
            });
            ctx.lineCap = "butt";
        }
    },
    {
        id: "corner-tri", name: "사선 포인트", align: "left", pad: [60, 60, 56, 64],
        draw: function (ctx, c) {
            ctx.fillStyle = c.sub;
            ctx.beginPath();
            ctx.moveTo(W - 330, H);
            ctx.lineTo(W, H - 210);
            ctx.lineTo(W, H);
            ctx.fill();
            ctx.fillStyle = c.main;
            ctx.beginPath();
            ctx.moveTo(W - 200, H);
            ctx.lineTo(W, H - 128);
            ctx.lineTo(W, H);
            ctx.fill();
        }
    },
    {
        id: "circles", name: "원 포인트", align: "left", pad: [60, 230, 56, 64],
        draw: function (ctx, c) {
            ctx.fillStyle = c.sub;
            ctx.beginPath();
            ctx.arc(W + 30, H * 0.5, 230, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = c.main;
            ctx.beginPath();
            ctx.arc(W + 40, H * 0.5, 160, 0, Math.PI * 2);
            ctx.fill();
        }
    },
    {
        id: "center", name: "가운데 정렬", align: "center", pad: [44, 60, 44, 60],
        draw: function (ctx, c) {
            ctx.strokeStyle = c.sub;
            ctx.lineWidth = 2;
            ctx.strokeRect(20, 20, W - 40, H - 40);
            ctx.fillStyle = c.main;
            ctx.fillRect(W / 2 - 30, H - 34, 60, 6);
        }
    },
    {
        id: "right", name: "오른쪽 정렬", align: "right", pad: [60, 66, 56, 60],
        draw: function (ctx, c) {
            ctx.fillStyle = c.main;
            ctx.fillRect(0, 0, 14, H);
            ctx.fillStyle = c.sub;
            ctx.fillRect(66, H / 2 - 1, 120, 3);
        }
    }
];

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
        if (joining) parts.push({ text: "", weight: 400, size: 19, color: TEXT_COLOR, gap: 26 });
        if (label) parts.push({ text: label, weight: 700, size: 19, color: state.main, gap: 12, minWidth: joining ? 0 : labelWidth });
        parts.push({ text: value, weight: 400, size: 19, color: TEXT_COLOR });
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
    if (state.dept.trim()) {
        lines.push({ parts: [{ text: state.dept.trim(), weight: 400, size: 21, color: SUB_TEXT_COLOR }], height: 34, descent: 8 });
    }
    const nameParts = [];
    if (state.name.trim()) nameParts.push({ text: state.name.trim(), weight: 700, size: 50, color: TEXT_COLOR, gap: 14 });
    if (state.title.trim()) nameParts.push({ text: state.title.trim(), weight: 400, size: 24, color: SUB_TEXT_COLOR });
    if (nameParts.length) lines.push({ parts: nameParts, height: 62, descent: 12 });
    return lines;
}

function drawShape(ctx, s) {
    ctx.fillStyle = s.color;
    if (s.type === "rect" || s.type === "line") {
        ctx.fillRect(s.x, s.y, s.w, s.h);
    } else if (s.type === "circle") {
        ctx.beginPath();
        ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
    } else if (s.type === "triangle") {
        ctx.beginPath();
        ctx.moveTo(s.x + s.w / 2, s.y);
        ctx.lineTo(s.x + s.w, s.y + s.h);
        ctx.lineTo(s.x, s.y + s.h);
        ctx.closePath();
        ctx.fill();
    }
}

// 명함 한 장 그리기 (설계 단위 W × H 좌표). 각 요소의 자리를 돌려줌
function drawCard(ctx, templateId, useOffsets) {
    const t = findTemplate(templateId);
    const colors = { main: state.main, sub: state.sub };
    const found = [];

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    t.draw(ctx, colors);
    ctx.restore();

    state.shapes.forEach(function (s) {
        drawShape(ctx, s);
        found.push({ key: "shape:" + s.id, x: s.x, y: s.y, w: s.w, h: s.h });
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
        const parts = [{ text: state.company.trim(), weight: 700, size: 32, color: state.main }];
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

    // 고른 요소 표시 (저장되는 그림에는 안 들어감)
    const box = boxes.find(function (b) { return b.key === selected; });
    if (box) {
        ctx.save();
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#03b75a";
        ctx.strokeRect(box.x - 6, box.y - 6, box.w + 12, box.h + 12);
        ctx.restore();
    }
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
    group.addEventListener("click", function (event) {
        const target = event.target.closest("button");
        if (!target) return;
        select(target);
        onChange(target.dataset.value);
    });
    picker.addEventListener("input", function () {
        select(picker);
        onChange(picker.value);
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
    remove.addEventListener("click", function () {
        state.logoSource = null;
        delete state.offsets.logo;
        if (selected === "logo") selected = null;
        showLogoFile();
        updateLogo();
    });
    chip.append(name, remove);
    logoFile.append(chip);
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

const SHAPE_NAMES = { rect: "사각형", circle: "원", line: "선", triangle: "삼각형" };

function addShape(type) {
    const size = {
        rect: [140, 90], circle: [110, 110], line: [240, 6], triangle: [120, 104]
    }[type];
    const s = {
        id: ++shapeSeq, type: type, color: state.main,
        w: size[0], h: size[1], x: (W - size[0]) / 2, y: (H - size[1]) / 2
    };
    state.shapes.push(s);
    selected = "shape:" + s.id;
    buildShapeList();
    render();
}

function buildShapeList() {
    shapeList.replaceChildren();
    state.shapes.forEach(function (s, i) {
        const item = document.createElement("div");
        item.className = "shape-item" + (selected === "shape:" + s.id ? " active" : "");

        const head = document.createElement("div");
        head.className = "shape-head";
        const title = document.createElement("strong");
        title.textContent = SHAPE_NAMES[s.type] + " " + (i + 1);
        const color = document.createElement("input");
        color.type = "color";
        color.value = s.color;
        color.setAttribute("aria-label", title.textContent + " 색");
        color.addEventListener("input", function () { s.color = color.value; render(); });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "file-remove";
        remove.textContent = "×";
        remove.title = title.textContent + " 삭제";
        remove.setAttribute("aria-label", remove.title);
        remove.addEventListener("click", function () {
            state.shapes.splice(state.shapes.indexOf(s), 1);
            if (selected === "shape:" + s.id) selected = null;
            buildShapeList();
            render();
        });
        head.append(title, color, remove);
        item.append(head);

        // 크기: 가로, 세로 (선은 길이, 두께)
        const isLine = s.type === "line";
        [["w", isLine ? "길이" : "가로", 10, W], ["h", isLine ? "두께" : "세로", isLine ? 1 : 10, isLine ? 40 : H]].forEach(function (d) {
            const label = document.createElement("label");
            label.className = "shape-size";
            const text = document.createElement("span");
            text.textContent = d[1];
            const range = document.createElement("input");
            range.type = "range";
            range.min = d[2];
            range.max = d[3];
            range.value = s[d[0]];
            range.addEventListener("input", function () {
                // 가운데를 그대로 두고 크기만 바꾸기
                const before = s[d[0]];
                s[d[0]] = Number(range.value);
                if (d[0] === "w") s.x -= (s.w - before) / 2;
                else s.y -= (s.h - before) / 2;
                render();
            });
            label.append(text, range);
            item.append(label);
        });
        shapeList.append(item);
    });
}

/* ========== 미리보기에서 끌어서 옮기기 ========== */

function toDesign(event) {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * W / rect.width, (event.clientY - rect.top) * H / rect.height];
}

function hitTest(p) {
    // 위에 그려진 것부터 (글자·로고 → 나중에 더한 도형)
    for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i];
        if (p[0] >= b.x - 8 && p[0] <= b.x + b.w + 8 && p[1] >= b.y - 8 && p[1] <= b.y + b.h + 8) return b.key;
    }
    return null;
}

function moveSelected(dx, dy) {
    if (!selected) return;
    if (selected.indexOf("shape:") === 0) {
        const s = state.shapes.find(function (x) { return "shape:" + x.id === selected; });
        if (s) { s.x += dx; s.y += dy; }
    } else {
        const o = offsetOf(selected);
        state.offsets[selected] = [o[0] + dx, o[1] + dy];
    }
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
    const key = hitTest(p);
    selectKey(key);
    if (!key) return;
    drag = { last: p, id: event.pointerId };
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
});
canvas.addEventListener("pointermove", function (event) {
    const p = toDesign(event);
    if (!drag) {
        canvas.style.cursor = hitTest(p) ? "move" : "default";
        return;
    }
    moveSelected(p[0] - drag.last[0], p[1] - drag.last[1]);
    drag.last = p;
});
["pointerup", "pointercancel"].forEach(function (type) {
    canvas.addEventListener(type, function () { drag = null; });
});
canvas.addEventListener("keydown", function (event) {
    const step = event.shiftKey ? 10 : 2;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (move && selected) {
        event.preventDefault();
        moveSelected(move[0], move[1]);
    } else if (event.key === "Escape") {
        selectKey(null);
    }
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

ImageKit.setupTheme(document.getElementById("themeSelect"));
ImageKit.setupDropzone(document.getElementById("logoDrop"), document.getElementById("logoInput"), handleLogo);

setupSwatches(document.getElementById("mainColors"), document.getElementById("mainCustom"), function (color) {
    state.main = color;
    render();
});
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
    render();
});

logoClear.addEventListener("change", updateLogo);
logoSize.addEventListener("input", function () {
    state.logoScale = Number(logoSize.value) / 100;
    logoSizeValue.textContent = logoSize.value + "%";
    render();
});

["company", "name", "title", "dept"].forEach(bindText);
buildRows();
buildTemplateGrid();
window.addEventListener("resize", render);
render();
