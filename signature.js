// 서명·도장 만들기: 직접 그린 서명, 이름으로 만든 서명 샘플, 도장 샘플

/* ========== 글꼴 목록 ========== */

// [글꼴 이름, 굵기, 종류]  종류: hand 손글씨, brush 붓글씨, print 정자·디자인, en 영문 필기체
const SIGN_FONTS = [
    ["Nanum Brush Script", 400, "brush"], ["East Sea Dokdo", 400, "brush"], ["Dokdo", 400, "brush"],
    ["Song Myung", 400, "brush"], ["Yeon Sung", 400, "brush"], ["Kirang Haerang", 400, "brush"],
    ["Black And White Picture", 400, "brush"],
    ["Nanum Pen Script", 400, "hand"], ["Gaegu", 400, "hand"], ["Gaegu", 700, "hand"],
    ["Hi Melody", 400, "hand"], ["Gamja Flower", 400, "hand"], ["Poor Story", 400, "hand"],
    ["Single Day", 400, "hand"], ["Cute Font", 400, "hand"], ["Stylish", 400, "hand"],
    ["Dongle", 700, "hand"],
    ["Nanum Myeongjo", 800, "print"], ["Gowun Batang", 700, "print"], ["Hahmlet", 700, "print"],
    ["Noto Serif KR", 900, "print"], ["Diphylleia", 400, "print"], ["Gowun Dodum", 400, "print"],
    ["Do Hyeon", 400, "print"], ["Jua", 400, "print"], ["Black Han Sans", 400, "print"],
    ["Gugi", 400, "print"], ["Orbit", 400, "print"], ["Moirai One", 400, "print"],
    ["Gasoek One", 400, "print"], ["Bagel Fat One", 400, "print"], ["Grandiflora One", 400, "print"],
    ["Gothic A1", 900, "print"], ["Nanum Gothic", 800, "print"], ["Sunflower", 700, "print"],
    ["Great Vibes", 400, "en"], ["Dancing Script", 600, "en"], ["Allura", 400, "en"],
    ["Sacramento", 400, "en"], ["Mr Dafoe", 400, "en"], ["Alex Brush", 400, "en"],
    ["Herr Von Muellerhoff", 400, "en"], ["Monsieur La Doulaise", 400, "en"],
    ["Mrs Saint Delafield", 400, "en"], ["Homemade Apple", 400, "en"], ["Caveat", 600, "en"],
    ["Satisfy", 400, "en"], ["Kaushan Script", 400, "en"], ["Parisienne", 400, "en"],
    ["Cedarville Cursive", 400, "en"], ["La Belle Aurore", 400, "en"], ["Rouge Script", 400, "en"],
    ["Yellowtail", 400, "en"], ["Arizonia", 400, "en"], ["Marck Script", 400, "en"],
    ["Zeyada", 400, "en"], ["Pinyon Script", 400, "en"], ["Italianno", 400, "en"],
    ["Meddon", 400, "en"], ["Reenie Beanie", 400, "en"], ["Nothing You Could Do", 400, "en"],
    ["Qwigley", 400, "en"], ["Ms Madi", 400, "en"], ["Birthstone", 400, "en"],
    ["Corinthia", 400, "en"], ["Ballet", 400, "en"], ["WindSong", 400, "en"], ["Updock", 400, "en"],
    ["Petit Formal Script", 400, "en"], ["Pacifico", 400, "en"], ["Cookie", 400, "en"],
    ["Damion", 400, "en"], ["Euphoria Script", 400, "en"], ["Bilbo Swash Caps", 400, "en"],
    ["Whisper", 400, "en"]
].map(function (f) { return { family: f[0], weight: f[1], group: f[2] }; });

// 도장에 어울리는 글꼴 (한자가 없는 글꼴은 본명조로 대신 그림)
const STAMP_FONTS = [
    ["Nanum Myeongjo", 800], ["Noto Serif KR", 900], ["Gowun Batang", 700], ["Hahmlet", 700],
    ["Song Myung", 400], ["Black Han Sans", 400], ["Do Hyeon", 400], ["Jua", 400], ["Gugi", 400],
    ["Yeon Sung", 400], ["Nanum Brush Script", 400], ["East Sea Dokdo", 400], ["Dokdo", 400],
    ["Gothic A1", 900], ["Nanum Gothic", 800], ["Sunflower", 700], ["Stylish", 400],
    ["Diphylleia", 400], ["Gasoek One", 400], ["Bagel Fat One", 400], ["Orbit", 400], ["Gowun Dodum", 400]
].map(function (f) { return { family: f[0], weight: f[1] }; });

const SHAPE_NAMES = {
    circle: "원형", ellipse: "타원", square: "사각", rounded: "둥근사각",
    double: "이중원", wide: "가로형", corp: "법인 원형", corpSquare: "사각 직인"
};

/* ========== 공통 도구 ========== */

const $ = function (id) { return document.getElementById(id); };

// 같은 seed면 같은 모양이 나오도록 (미리보기와 저장 이미지가 같게)
function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
}

function fontString(font, size) {
    return font.weight + " " + size + "px \"" + font.family + "\", \"Noto Serif KR\", serif";
}

// 글꼴을 필요한 글자만 내려받기. 못 받은 글꼴은 false
const fontCache = new Map();
function loadFont(font, text) {
    const key = font.family + "|" + font.weight + "|" + text;
    if (!fontCache.has(key)) {
        const spec = font.weight + " 40px \"" + font.family + "\"";
        fontCache.set(key, document.fonts.load(spec, text)
            .then(function (faces) { return faces.length > 0; })
            .catch(function () { return false; }));
    }
    return fontCache.get(key);
}

let toastTimer = 0;
function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
}

function withWhite(canvas) {
    const out = makeCanvas(canvas.width, canvas.height);
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    return out;
}

function saveImage(canvas, filename, white) {
    ImageKit.downloadPng(white ? withWhite(canvas) : canvas, filename);
    toast("PNG를 저장했어요");
}

async function copyImage(canvas, white) {
    try {
        const blob = ImageKit.canvasToBlob(white ? withWhite(canvas) : canvas);
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("이미지를 복사했어요. 문서에 붙여넣기 하세요");
    } catch (e) {
        toast("이 브라우저에서는 복사할 수 없어요. PNG 저장을 이용해 주세요");
    }
}

function safeName(text) {
    return (text || "서명").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 30);
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

function debounce(fn, wait) {
    let timer = 0;
    return function () {
        clearTimeout(timer);
        timer = setTimeout(fn, wait);
    };
}

// 샘플 카드: 미리보기 + 저장/복사 버튼. makeLarge()는 저장용 큰 이미지를 만듦
function sampleCard(preview, label, makeLarge, filename, whiteCheck) {
    const figure = document.createElement("figure");
    figure.className = "sample";
    const art = document.createElement("div");
    art.className = "sample-art";
    art.appendChild(preview);
    const caption = document.createElement("figcaption");
    const name = document.createElement("span");
    name.textContent = label;
    name.title = label;
    const actions = document.createElement("div");
    actions.className = "sample-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "저장";
    save.addEventListener("click", function () { saveImage(makeLarge(), filename, whiteCheck.checked); });
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "복사";
    copy.addEventListener("click", function () { copyImage(makeLarge(), whiteCheck.checked); });
    actions.append(save, copy);
    caption.append(name, actions);
    figure.append(art, caption);
    return figure;
}

// 카드를 조금씩 나눠 붙여서 화면이 멈추지 않게. 새로 시작하면 이전 작업은 멈춤
function createGallery(grid, countEl, statusEl) {
    let token = 0;
    return {
        async show(items, buildCard, append) {
            const mine = ++token;
            if (!append) grid.innerHTML = "";
            const empty = grid.querySelector(".empty-note");
            if (empty) empty.remove();
            for (let i = 0; i < items.length; i++) {
                if (i % 6 === 0) {
                    statusEl.textContent = "만드는 중… " + i + " / " + items.length;
                    await ImageKit.nextFrame();
                    if (mine !== token) return;
                }
                const card = buildCard(items[i]);
                if (card) grid.appendChild(card);
            }
            statusEl.textContent = "";
            countEl.textContent = grid.querySelectorAll(".sample").length + "개";
        },
        stop() { token++; },
        message(text) {
            token++;
            grid.innerHTML = "";
            const p = document.createElement("p");
            p.className = "empty-note";
            p.textContent = text;
            grid.appendChild(p);
            countEl.textContent = "";
            statusEl.textContent = "";
        },
        status(text) { statusEl.textContent = text; }
    };
}

/* ========== 서명하기 (직접 그리기) ========== */

const pad = $("pad");
const padCtx = pad.getContext("2d");
const penWidth = $("penWidth");
const pressureCheck = $("pressureCheck");
let drawColor = "#111111";
let strokes = [];      // 점 좌표는 칸 너비 기준 비율로 저장 (창 크기가 바뀌어도 그대로)
let currentStroke = null;
let lastPoint = null;
let padFrame = 0;

// width: 칸 너비가 600px일 때 펜 굵기(px)
function drawStrokes(ctx, list, canvasWidth, color, width) {
    const unit = canvasWidth;
    const base = width * canvasWidth / 600;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    list.forEach(function (stroke) {
        const p = stroke;
        if (p.length === 1) {
            ctx.beginPath();
            ctx.arc(p[0].x * unit, p[0].y * unit, base * p[0].m / 2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        let fromX = p[0].x * unit;
        let fromY = p[0].y * unit;
        for (let i = 1; i < p.length; i++) {
            const last = i === p.length - 1;
            const toX = last ? p[i].x * unit : (p[i].x + p[i + 1].x) / 2 * unit;
            const toY = last ? p[i].y * unit : (p[i].y + p[i + 1].y) / 2 * unit;
            ctx.beginPath();
            ctx.lineWidth = base * p[i].m;
            ctx.moveTo(fromX, fromY);
            ctx.quadraticCurveTo(p[i].x * unit, p[i].y * unit, toX, toY);
            ctx.stroke();
            fromX = toX;
            fromY = toY;
        }
    });
}

function redrawPad() {
    padFrame = 0;
    padCtx.clearRect(0, 0, pad.width, pad.height);
    drawStrokes(padCtx, strokes, pad.width, drawColor, Number(penWidth.value));
    $("padPlaceholder").hidden = strokes.length > 0;
    const has = strokes.length > 0;
    ["undoButton", "clearButton", "drawSave", "drawCopy"].forEach(function (id) { $(id).disabled = !has; });
}

function schedulePad() {
    if (!padFrame) padFrame = requestAnimationFrame(redrawPad);
}

function resizePad() {
    const rect = pad.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    pad.width = Math.round(rect.width * dpr);
    pad.height = Math.round(rect.height * dpr);
    redrawPad();
}

function padPoint(event) {
    const rect = pad.getBoundingClientRect();
    const point = {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.width,
        t: event.timeStamp,
        m: 1
    };
    if (!pressureCheck.checked) return point;
    if (event.pointerType === "pen" && event.pressure > 0) {
        point.m = 0.35 + event.pressure * 1.1;
    } else if (lastPoint) {
        // 빠르게 그을수록 가늘게 (화면 너비 기준 속도)
        const dist = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) * rect.width;
        const speed = dist / Math.max(1, point.t - lastPoint.t);
        const target = Math.min(1.35, Math.max(0.35, 1.4 - speed * 0.45));
        point.m = lastPoint.m * 0.65 + target * 0.35;
    }
    return point;
}

pad.addEventListener("pointerdown", function (event) {
    event.preventDefault();
    pad.setPointerCapture(event.pointerId);
    lastPoint = null;
    const point = padPoint(event);
    lastPoint = point;
    currentStroke = [point];
    strokes.push(currentStroke);
    schedulePad();
});

pad.addEventListener("pointermove", function (event) {
    if (!currentStroke) return;
    const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    (events.length ? events : [event]).forEach(function (e) {
        const point = padPoint(e);
        if (Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < 0.0015) return;
        currentStroke.push(point);
        lastPoint = point;
    });
    schedulePad();
});

["pointerup", "pointercancel"].forEach(function (type) {
    pad.addEventListener(type, function () {
        currentStroke = null;
        lastPoint = null;
    });
});

// 저장용: 큰 캔버스에 다시 그린 뒤 빈 곳 잘라내기
function exportDrawing() {
    const width = 1800;
    const rect = pad.getBoundingClientRect();
    const canvas = makeCanvas(width, width * rect.height / rect.width);
    drawStrokes(canvas.getContext("2d"), strokes, width, drawColor, Number(penWidth.value));
    return ImageKit.trimTransparent(canvas, 30) || canvas;
}

$("undoButton").addEventListener("click", function () { strokes.pop(); redrawPad(); });
$("clearButton").addEventListener("click", function () { strokes = []; redrawPad(); });
$("drawSave").addEventListener("click", function () { saveImage(exportDrawing(), "서명.png", $("drawWhite").checked); });
$("drawCopy").addEventListener("click", function () { copyImage(exportDrawing(), $("drawWhite").checked); });
penWidth.addEventListener("input", function () { $("penWidthValue").textContent = penWidth.value; redrawPad(); });
setupSwatches($("drawColors"), $("drawCustom"), function (color) { drawColor = color; redrawPad(); });
window.addEventListener("resize", debounce(resizePad, 100));

/* ========== 서명 만들기 (이름 → 서명 샘플) ========== */

const signName = $("signName");
const signNameEn = $("signNameEn");
const signWhite = $("signWhite");
const signGallery = createGallery($("signGrid"), $("signCount"), $("signStatus"));
let signColor = "#111111";
let signGroup = "all";
let signSamples = [];
let seedCounter = 1;

function cleanStyle(font) {
    return { slant: font.group === "en" ? 0 : 0.12, jitter: 0.08, flourish: 0, capBoost: 1, spacing: 1, rise: 0, seed: seedCounter++ };
}

function randomStyle(font) {
    const seed = seedCounter++ * 7919 + Math.floor(Math.random() * 100000);
    const rng = seededRandom(seed);
    const slants = font.group === "en" ? [-0.05, 0, 0.08, 0.15] : [-0.05, 0, 0.12, 0.22, 0.32];
    return {
        slant: slants[Math.floor(rng() * slants.length)],
        jitter: 0.2 + rng() * 0.7,
        flourish: Math.floor(rng() * 7),
        capBoost: rng() < 0.45 ? 1 : 1.18 + rng() * 0.35,
        spacing: 0.8 + rng() * 0.25,
        rise: (rng() - 0.35) * 0.16,
        seed: seed
    };
}

// 영문은 전체 이름, 첫 글자+성, 이니셜 서명
function englishVariants(text) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 2) return [text, text];
    return [
        text,
        text,
        words[0][0].toUpperCase() + ". " + words.slice(1).join(" "),
        words.map(function (w) { return w[0].toUpperCase(); }).join("")
    ];
}

function signTexts() {
    return {
        ko: signName.value.trim(),
        en: /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(signNameEn.value) ? "" : signNameEn.value.trim()
    };
}

function pickText(font, texts, random) {
    if (font.group !== "en") return texts.ko;
    if (!random) return texts.en;
    const variants = englishVariants(texts.en);
    return variants[Math.floor(Math.random() * variants.length)];
}

function fontsInGroup() {
    const texts = signTexts();
    return SIGN_FONTS.filter(function (f) {
        if (signGroup !== "all" && f.group !== signGroup) return false;
        return f.group === "en" ? !!texts.en : !!texts.ko;
    });
}

// 펜 획처럼 가운데가 두껍고 양 끝이 가는 선
function taperedPath(ctx, point, width, steps) {
    let prev = point(0);
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const next = point(t);
        ctx.beginPath();
        ctx.lineWidth = width * (0.15 + 0.85 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
        ctx.moveTo(prev[0], prev[1]);
        ctx.lineTo(next[0], next[1]);
        ctx.stroke();
        prev = next;
    }
}

function bezier(p0, p1, p2, p3) {
    return function (t) {
        const u = 1 - t;
        return [
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
        ];
    };
}

function drawFlourish(ctx, type, end, size, rng) {
    const w = size * 0.05;
    const r = function (k) { return (rng() - 0.5) * size * k; };
    if (type === 1) {        // 아래로 휘는 밑줄
        taperedPath(ctx, bezier([-size * 0.3, size * 0.32], [end * 0.3, size * 0.62 + r(0.2)], [end * 0.8, size * 0.38], [end + size * 0.5, size * 0.05 + r(0.2)]), w, 60);
    } else if (type === 2) { // 마지막 글자에서 돌아 나오는 고리
        taperedPath(ctx, bezier([end - size * 0.1, -size * 0.15], [end + size * 0.9, size * 0.55], [end * 0.35, size * 0.7 + r(0.2)], [-size * 0.25, size * 0.25]), w, 70);
    } else if (type === 3) { // 두 줄 밑줄
        taperedPath(ctx, bezier([-size * 0.1, size * 0.3], [end * 0.3, size * 0.36], [end * 0.7, size * 0.3], [end + size * 0.2, size * 0.26]), w * 0.8, 40);
        taperedPath(ctx, bezier([size * 0.15, size * 0.46], [end * 0.4, size * 0.5], [end * 0.7, size * 0.46], [end - size * 0.05, size * 0.42]), w * 0.6, 40);
    } else if (type === 4) { // 위로 치켜 올리는 꼬리
        taperedPath(ctx, bezier([end - size * 0.15, size * 0.15], [end + size * 0.25, size * 0.4], [end + size * 0.6, size * 0.1], [end + size * 1.0, -size * 0.55 + r(0.2)]), w, 50);
    } else if (type === 5) { // 이름을 감싸는 타원
        const cx = end / 2;
        const rx = end / 2 + size * 0.55;
        const ry = size * 0.72;
        const start = -0.25 + rng() * 0.3;
        taperedPath(ctx, function (t) {
            const a = start + t * Math.PI * 1.75;
            return [cx + Math.cos(a) * rx, -size * 0.32 + Math.sin(a) * ry];
        }, w * 0.8, 90);
    } else if (type === 6) { // 가로지르는 긴 획
        taperedPath(ctx, bezier([-size * 0.4, size * 0.05], [end * 0.3, -size * 0.25], [end * 0.7, -size * 0.2 + r(0.2)], [end + size * 0.6, -size * 0.5]), w * 0.75, 50);
    }
}

function renderSignature(sample, color, scale) {
    const st = sample.style;
    const rng = seededRandom(st.seed);
    const size = 72 * scale;
    const chars = Array.from(sample.text);
    const font = sample.font;

    const measure = makeCanvas(1, 1).getContext("2d");
    measure.font = fontString(font, size);
    const textWidth = measure.measureText(sample.text).width * Math.max(1, st.capBoost);
    const canvas = makeCanvas(textWidth * 1.3 + size * 4, size * 3.4);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.translate(size * 1.6, canvas.height * 0.58);
    ctx.rotate(-st.rise);
    ctx.transform(1, 0, -st.slant, 1, 0, 0);

    let x = 0;
    if (font.group === "en") {
        // 필기체는 글자가 이어지도록 통째로 쓰고, 첫 글자만 크게
        let rest = sample.text;
        if (st.capBoost > 1 && chars.length > 1) {
            ctx.font = fontString(font, size * st.capBoost);
            ctx.fillText(chars[0], 0, 0);
            x += ctx.measureText(chars[0]).width * 0.92;
            rest = chars.slice(1).join("");
        }
        ctx.font = fontString(font, size);
        ctx.fillText(rest, x, 0);
        x += ctx.measureText(rest).width;
    } else {
        // 한글은 한 글자씩 크기·높이·각도를 조금씩 흔들어 손으로 쓴 느낌
        chars.forEach(function (ch, i) {
            const grow = (i === 0 ? st.capBoost : 1) * (1 + (rng() - 0.5) * st.jitter * 0.25);
            ctx.save();
            ctx.font = fontString(font, size * grow);
            ctx.translate(x, (rng() - 0.5) * st.jitter * size * 0.22);
            ctx.rotate((rng() - 0.5) * st.jitter * 0.3);
            ctx.fillText(ch, 0, 0);
            const advance = ctx.measureText(ch).width;
            ctx.restore();
            x += advance * (ch === " " ? 0.6 : st.spacing);
        });
    }
    drawFlourish(ctx, st.flourish, x, size, rng);
    return ImageKit.trimTransparent(canvas, Math.round(10 * scale)) || canvas;
}

function signCard(sample) {
    const preview = renderSignature(sample, signColor, 2);
    const label = sample.font.family + (sample.font.weight >= 700 && sample.font.group !== "print" ? " 굵게" : "");
    return sampleCard(preview, label, function () {
        return renderSignature(sample, signColor, 4);
    }, "서명_" + safeName(sample.text) + ".png", signWhite);
}

async function showSignSamples(list, append) {
    const texts = signTexts();
    if (!texts.ko && !texts.en) {
        signGallery.message("이름을 입력하면 서명 샘플이 나타나요.");
        return;
    }
    if (!list.length) {
        signGallery.message(signGroup === "en" ? "영문 이름을 입력하면 영문 필기체 서명이 나타나요." : "이 종류에 맞는 이름을 입력해 주세요.");
        return;
    }
    signGallery.stop();
    signGallery.status("글꼴 불러오는 중…");
    const ok = await Promise.all(list.map(function (s) { return loadFont(s.font, s.text); }));
    signGallery.show(list.filter(function (s, i) { return ok[i]; }), signCard, append);
}

function rebuildSignSamples() {
    const texts = signTexts();
    signSamples = [];
    SIGN_FONTS.forEach(function (font) {
        const text = font.group === "en" ? texts.en : texts.ko;
        if (!text) return;
        signSamples.push({ font: font, text: text, style: cleanStyle(font) });
        signSamples.push({ font: font, text: pickText(font, texts, true), style: randomStyle(font) });
    });
    showSignSamples(visibleSignSamples(), false);
}

function visibleSignSamples() {
    return signSamples.filter(function (s) { return signGroup === "all" || s.font.group === signGroup; });
}

$("signMore").addEventListener("click", function () {
    const texts = signTexts();
    const added = fontsInGroup().map(function (font) {
        return { font: font, text: pickText(font, texts, true), style: randomStyle(font) };
    });
    signSamples = signSamples.concat(added);
    showSignSamples(added, true);
    if (added.length) toast("샘플 " + added.length + "개를 더 만들었어요");
});

const rebuildSignLater = debounce(rebuildSignSamples, 350);
const recolorSignLater = debounce(function () { showSignSamples(visibleSignSamples(), false); }, 120);
signName.addEventListener("input", rebuildSignLater);
signNameEn.addEventListener("input", rebuildSignLater);
ImageKit.setupSegmented($("signGroups"), function (value) {
    signGroup = value;
    showSignSamples(visibleSignSamples(), false);
});
setupSwatches($("signColors"), $("signCustom"), function (color) {
    signColor = color;
    recolorSignLater();
});

/* ========== 도장 만들기 ========== */

const stampName = $("stampName");
const companyName = $("companyName");
const stampWear = $("stampWear");
const stampBorder = $("stampBorder");
const stampWhite = $("stampWhite");
const stampGallery = createGallery($("stampGrid"), $("stampCount"), $("stampStatus"));
const WEAR_LABELS = ["깨끗하게", "살짝", "보통", "많이", "아주 많이"];
const BORDER_LABELS = ["아주 얇게", "얇게", "보통", "굵게", "아주 굵게"];
let stampColor = "#d42a2a";
let stampSuffix = "인";
let stampShape = "all";
let stampCarve = "relief";
let stampOrder = "vertical";

// 오른쪽 열부터 위→아래로 읽는 도장 배치. 남는 글자는 왼쪽 열로 (예: 홍 | 길동)
function columnCells(count, cols, box) {
    const base = Math.floor(count / cols);
    const extra = count % cols;
    const colW = box.w / cols;
    const cells = [];
    for (let c = 0; c < cols; c++) {
        const rows = base + (c >= cols - extra ? 1 : 0);
        const x = box.x + box.w - (c + 1) * colW;
        for (let r = 0; r < rows; r++) {
            cells.push({ x: x, y: box.y + r * box.h / rows, w: colW, h: box.h / rows });
        }
    }
    return cells;
}

function rowCells(count, box) {
    const cells = [];
    for (let i = 0; i < count; i++) {
        cells.push({ x: box.x + i * box.w / count, y: box.y, w: box.w / count, h: box.h });
    }
    return cells;
}

// 가로쓰기: 왼쪽→오른쪽, 위 줄부터. 남는 글자는 아래 줄로
function lineCells(count, lines, box) {
    const base = Math.floor(count / lines);
    const extra = count % lines;
    const rowH = box.h / lines;
    const cells = [];
    for (let r = 0; r < lines; r++) {
        const n = base + (r >= lines - extra ? 1 : 0);
        for (let i = 0; i < n; i++) {
            cells.push({ x: box.x + i * box.w / n, y: box.y + r * rowH, w: box.w / n, h: rowH });
        }
    }
    return cells;
}

// 도장 글자 배치 (세로쓰기 전통식 / 가로쓰기)
function gridCells(count, box) {
    const lines = autoColumns(count);
    return stampOrder === "horizontal" ? lineCells(count, lines, box) : columnCells(count, lines, box);
}

// 글자 칸이 대략 정사각형이 되는 배치 영역의 가로세로 비율
function gridAspect(count, min, max) {
    const lines = autoColumns(count);
    const per = Math.ceil(count / lines);
    const aspect = stampOrder === "horizontal" ? per / lines : lines / per;
    return Math.min(max, Math.max(min, aspect));
}

function autoColumns(count) {
    if (count <= 2) return 1;
    if (count <= 6) return 2;
    if (count <= 12) return 3;
    return 4;
}

// 타원(원) 안에 들어가는 가로세로 비율 aspect의 사각형
function boxInEllipse(cx, cy, rx, ry, aspect) {
    const h = 1 / Math.sqrt(aspect * aspect / (4 * rx * rx) + 1 / (4 * ry * ry));
    const w = aspect * h;
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
}

// 칸을 꽉 채우도록 글자를 늘려 그림 (도장 글씨처럼). 너무 찌그러지지는 않게
function drawGlyph(ctx, ch, cell, font) {
    const base = 100;
    ctx.font = fontString(font, base);
    const m = ctx.measureText(ch);
    const left = m.actualBoundingBoxLeft;
    const right = m.actualBoundingBoxRight;
    const ascent = m.actualBoundingBoxAscent;
    const descent = m.actualBoundingBoxDescent;
    const gw = left + right;
    const gh = ascent + descent;
    if (!(gw > 0 && gh > 0)) return;
    const pad = Math.min(cell.w, cell.h) * 0.05;
    let sx = (cell.w - pad * 2) / gw;
    let sy = (cell.h - pad * 2) / gh;
    if (sx > sy * 1.7) sx = sy * 1.7;
    if (sy > sx * 1.7) sy = sx * 1.7;
    ctx.save();
    ctx.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
    ctx.scale(sx, sy);
    ctx.fillText(ch, -(right - left) / 2, (ascent - descent) / 2);
    ctx.restore();
}

// 인주가 덜 묻은 듯한 얼룩 (seed로 같은 모양 유지, 크기에 비례)
function applyWear(ctx, w, h, unit, level, rng) {
    if (!level) return;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    const dots = Math.round(level * level * 260 * (w * h) / (unit * unit));
    for (let i = 0; i < dots; i++) {
        ctx.globalAlpha = 0.35 + rng() * 0.65;
        ctx.beginPath();
        ctx.arc(rng() * w, rng() * h, (0.4 + rng() * rng() * 2.4) * unit / 300, 0, Math.PI * 2);
        ctx.fill();
    }
    const patches = level * 2;
    for (let i = 0; i < patches; i++) {
        const x = rng() * w;
        const y = rng() * h;
        const r = (0.12 + rng() * 0.25) * unit;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(0,0,0," + (0.12 + level * 0.07) + ")");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    if (level >= 3) {
        ctx.lineCap = "round";
        for (let i = 0; i < level * 2; i++) {
            ctx.globalAlpha = 0.5 + rng() * 0.4;
            ctx.lineWidth = (0.6 + rng()) * unit / 300;
            const x = rng() * w;
            const y = rng() * h;
            const a = rng() * Math.PI;
            const len = (0.05 + rng() * 0.15) * unit;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
            ctx.stroke();
        }
    }
    ctx.restore();
}

function ellipsePath(ctx, cx, cy, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// 테두리(선)를 그리고, 글자를 넣을 사각형 칸들을 돌려줌
function renderStamp(spec, color, scale) {
    const S = 300 * scale;
    const bw = S * [0.02, 0.03, 0.042, 0.056, 0.072][Number(stampBorder.value) - 1];
    const margin = bw / 2 + S * 0.02;
    const gap = bw / 2 + S * 0.04;
    const intaglio = spec.carve === "intaglio";
    const chars = spec.chars;
    const sizes = { ellipse: [0.72, 1], wide: [1.7, 0.62], corp: [1.1, 1.1], corpSquare: [1.05, 1.05] };
    const size = sizes[spec.shape] || [1, 1];
    const W = S * size[0];
    const H = S * size[1];
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = bw;

    // 양각: 테두리 선. 음각: 모양을 칠하고 글자를 파냄
    function outline(pathFn) {
        pathFn();
        if (intaglio) ctx.fill();
        else ctx.stroke();
    }

    let cells = [];
    const cx = W / 2;
    const cy = H / 2;
    if (spec.shape === "circle" || spec.shape === "double" || spec.shape === "ellipse") {
        let rx = W / 2 - margin;
        let ry = H / 2 - margin;
        outline(function () { ellipsePath(ctx, cx, cy, rx, ry); });
        if (spec.shape === "double") {
            const inner = 0.86;
            ctx.save();
            ctx.lineWidth = bw * 0.6;
            if (intaglio) {
                ctx.globalCompositeOperation = "destination-out";
                ctx.lineWidth = bw * 0.5;
                ellipsePath(ctx, cx, cy, rx * (inner + 0.06), ry * (inner + 0.06));
                ctx.stroke();
            } else {
                ellipsePath(ctx, cx, cy, rx * inner, ry * inner);
                ctx.stroke();
            }
            ctx.restore();
            rx *= inner;
            ry *= inner;
        }
        const tx = rx - gap;
        const ty = ry - gap;
        if (spec.shape === "ellipse") {
            cells = columnCells(chars.length, 1, boxInEllipse(cx, cy, tx, ty, Math.max(0.32, 1.05 / chars.length)));
        } else {
            cells = gridCells(chars.length, boxInEllipse(cx, cy, tx, ty, gridAspect(chars.length, 0.55, 1.8)));
        }
    } else if (spec.shape === "square" || spec.shape === "rounded" || spec.shape === "corpSquare") {
        const radius = spec.shape === "rounded" ? S * 0.16 : S * 0.01;
        outline(function () { roundRectPath(ctx, margin, margin, W - margin * 2, H - margin * 2, radius); });
        const inset = margin + gap - S * 0.01;
        cells = gridCells(chars.length, { x: inset, y: inset, w: W - inset * 2, h: H - inset * 2 });
    } else if (spec.shape === "wide") {
        outline(function () { roundRectPath(ctx, margin, margin, W - margin * 2, H - margin * 2, H * 0.12); });
        const inset = margin + gap;
        const boxW = Math.min(W - inset * 2, (H - inset * 2) * 1.05 * chars.length);
        cells = rowCells(chars.length, { x: (W - boxW) / 2, y: inset, w: boxW, h: H - inset * 2 });
    } else if (spec.shape === "corp") {
        const R = W / 2 - margin;
        const r = R * 0.6;
        outline(function () { ellipsePath(ctx, cx, cy, R, R); });
        ctx.save();
        ctx.lineWidth = bw * 0.7;
        if (intaglio) ctx.globalCompositeOperation = "destination-out";
        ellipsePath(ctx, cx, cy, r, r);
        ctx.stroke();
        ctx.restore();
        // 바깥 고리에 회사명을 시계 방향으로 (아래쪽에 별)
        const ring = spec.ring;
        const slots = ring.length + 1;
        const mid = (R - bw / 2 + r + bw * 0.35) / 2;
        const band = (R - bw / 2) - (r + bw * 0.35);
        const arc = 2 * Math.PI * mid / slots;
        if (intaglio) ctx.globalCompositeOperation = "destination-out";
        for (let i = 0; i <= ring.length; i++) {
            const angle = Math.PI / 2 + (i + 1) * 2 * Math.PI / slots;
            const ch = i === ring.length ? "★" : ring[i];
            if (ch === " ") continue;
            ctx.save();
            ctx.translate(cx + Math.cos(angle) * mid, cy + Math.sin(angle) * mid);
            ctx.rotate(angle + Math.PI / 2);
            const isStar = ch === "★";
            const cw = Math.min(arc * 0.92, band * 0.9) * (isStar ? 0.7 : 1);
            const chH = band * 0.78 * (isStar ? 0.7 : 1);
            drawGlyph(ctx, ch, { x: -cw / 2, y: -chH / 2, w: cw, h: chH }, spec.font);
            ctx.restore();
        }
        ctx.globalCompositeOperation = "source-over";
        cells = gridCells(chars.length, boxInEllipse(cx, cy, r - gap, r - gap, gridAspect(chars.length, 0.6, 1.6)));
    }

    if (intaglio) ctx.globalCompositeOperation = "destination-out";
    cells.forEach(function (cell, i) { drawGlyph(ctx, chars[i], cell, spec.font); });
    ctx.globalCompositeOperation = "source-over";

    applyWear(ctx, W, H, S, Number(stampWear.value), seededRandom(spec.seed));
    return canvas;
}

function stampSpecs() {
    const name = stampName.value.replace(/\s+/g, "");
    const company = companyName.value.trim().replace(/\s+/g, " ");
    const specs = [];
    const carves = stampCarve === "both" ? ["relief", "intaglio"] : [stampCarve];
    const personal = ["circle", "ellipse", "square", "rounded", "double", "wide"];
    let seed = 11;
    STAMP_FONTS.forEach(function (font) {
        carves.forEach(function (carve) {
            if (name) {
                const chars = Array.from(name + stampSuffix);
                personal.forEach(function (shape) {
                    if (stampShape !== "all" && stampShape !== shape) return;
                    specs.push({ shape: shape, font: font, carve: carve, chars: chars, seed: seed++, label: name + stampSuffix });
                });
            }
            if (company && (stampShape === "all" || stampShape === "corp")) {
                specs.push({ shape: "corp", font: font, carve: carve, chars: Array.from("대표이사" + (stampSuffix || "인")), ring: Array.from(company), seed: seed++, label: company });
                specs.push({ shape: "corpSquare", font: font, carve: carve, chars: Array.from(company.replace(/\s+/g, "") + (stampSuffix || "之印")), seed: seed++, label: company });
            }
        });
    });
    // 같은 모양끼리 모이도록 정렬 (글꼴 순서는 유지)
    const order = ["circle", "double", "square", "rounded", "ellipse", "wide", "corp", "corpSquare"];
    return specs.sort(function (a, b) { return order.indexOf(a.shape) - order.indexOf(b.shape); });
}

function stampCard(spec) {
    const label = SHAPE_NAMES[spec.shape] + (spec.carve === "intaglio" ? " 음각" : "") + " · " + spec.font.family;
    return sampleCard(renderStamp(spec, stampColor, 1.2), label, function () {
        return renderStamp(spec, stampColor, 4);
    }, "도장_" + safeName(spec.label) + ".png", stampWhite);
}

async function showStamps() {
    const specs = stampSpecs();
    if (!specs.length) {
        stampGallery.message(stampShape === "corp" ? "회사·단체명을 입력하면 법인 도장 샘플이 나타나요." : "도장에 새길 글자를 입력해 주세요.");
        return;
    }
    stampGallery.stop();
    stampGallery.status("글꼴 불러오는 중…");
    const text = stampName.value + stampSuffix + companyName.value + "대표이사인之印★";
    const ok = await Promise.all(STAMP_FONTS.map(function (f) { return loadFont(f, text); }));
    const usable = specs.filter(function (s) { return ok[STAMP_FONTS.indexOf(s.font)]; });
    stampGallery.show(usable, stampCard, false);
}

// 회사명을 넣었을 때만 '법인' 칩 보이기
const corpChip = document.createElement("button");
corpChip.type = "button";
corpChip.dataset.value = "corp";
corpChip.textContent = "법인·직인";
corpChip.hidden = true;
$("stampShapes").appendChild(corpChip);

const showStampsLater = debounce(showStamps, 300);
stampName.addEventListener("input", showStampsLater);
companyName.addEventListener("input", function () {
    corpChip.hidden = !companyName.value.trim();
    if (corpChip.hidden && stampShape === "corp") $("stampShapes").firstElementChild.click();
    showStampsLater();
});
stampWear.addEventListener("input", function () {
    $("stampWearValue").textContent = WEAR_LABELS[stampWear.value];
    showStampsLater();
});
stampBorder.addEventListener("input", function () {
    $("stampBorderValue").textContent = BORDER_LABELS[stampBorder.value - 1];
    showStampsLater();
});
ImageKit.setupSegmented($("stampSuffix"), function (value) { stampSuffix = value; showStamps(); });
ImageKit.setupSegmented($("stampShapes"), function (value) { stampShape = value; showStamps(); });
ImageKit.setupSegmented($("stampOrder"), function (value) { stampOrder = value; showStamps(); });
ImageKit.setupSegmented($("stampCarve"), function (value) { stampCarve = value; showStamps(); });
setupSwatches($("stampColors"), $("stampCustom"), function (color) { stampColor = color; showStampsLater(); });

/* ========== 탭 전환 ========== */

const MODES = ["draw", "make", "stamp"];
const started = {};

function showMode(mode) {
    if (MODES.indexOf(mode) < 0) mode = "make";
    MODES.forEach(function (m) { $("panel-" + m).hidden = m !== mode; });
    $("modeTabs").querySelectorAll("button").forEach(function (b) {
        const on = b.dataset.value === mode;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (mode === "draw") resizePad();
    if (!started[mode]) {
        started[mode] = true;
        if (mode === "make") rebuildSignSamples();
        if (mode === "stamp") showStamps();
    }
    if (location.hash !== "#" + mode) history.replaceState(null, "", "#" + mode);
}

$("modeTabs").addEventListener("click", function (event) {
    const target = event.target.closest("button");
    if (target) showMode(target.dataset.value);
});
window.addEventListener("hashchange", function () { showMode(location.hash.slice(1)); });

ImageKit.setupTheme($("themeSelect"));
showMode(location.hash.slice(1));
