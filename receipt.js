// 영수증 스캐너: 여러 장을 한 번에 → 영수증만 잘라 반듯하게 → 하얗고 선명하게 → ZIP

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const cropCheck = document.getElementById("cropCheck");
const modeSelect = document.getElementById("modeSelect");
const modeHelp = document.getElementById("modeHelp");
const strengthField = document.getElementById("strengthField");
const strength = document.getElementById("strength");
const strengthValue = document.getElementById("strengthValue");
const widthSelect = document.getElementById("widthSelect");
const formatSelect = document.getElementById("formatSelect");
const settingsNote = document.getElementById("settingsNote");
const reprocessButton = document.getElementById("reprocessButton");

const progressCard = document.getElementById("progressCard");
const progressTitle = document.getElementById("progressTitle");
const progressCount = document.getElementById("progressCount");
const progressBar = document.getElementById("progressBar");
const progressDetail = document.getElementById("progressDetail");
const progressEta = document.getElementById("progressEta");

const zipButton = document.getElementById("zipButton");
const stopButton = document.getElementById("stopButton");
const resumeButton = document.getElementById("resumeButton");
const clearButton = document.getElementById("clearButton");
const grid = document.getElementById("grid");
const gridEmpty = document.getElementById("gridEmpty");

const viewer = document.getElementById("viewer");
const viewerName = document.getElementById("viewerName");
const viewerToggle = document.getElementById("viewerToggle");
const viewerClose = document.getElementById("viewerClose");
const viewerImage = document.getElementById("viewerImage");
const toast = document.getElementById("toast");

const MODE_HELP = {
    gray: "그림자를 없애고 배경은 하얗게, 글씨는 진하게 바꿔요. 영수증에 가장 잘 맞아요.",
    color: "배경만 하얗게 바꾸고 도장·형광펜 같은 색은 그대로 둬요.",
    none: "색은 손대지 않고 자르기와 크기 조정만 해요."
};

let mode = "gray";

/* ==================== 이미지 처리 ==================== */

function grayOf(data, n) {
    const gray = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
        const i = p * 4;
        gray[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }
    return gray;
}

// 밝은 부분(종이)과 어두운 부분(책상)을 가르는 기준 밝기 (오츠 방법)
function otsuThreshold(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];

    let sumB = 0, wB = 0, best = 0, threshold = 128;
    for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (wB === 0) continue;
        const wF = gray.length - wB;
        if (wF === 0) break;
        sumB += t * hist[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > best) {
            best = between;
            threshold = t;
        }
    }
    return threshold;
}

// 사진에서 영수증의 네 모서리 찾기 → [왼쪽위, 오른쪽위, 오른쪽아래, 왼쪽아래] (못 찾으면 null)
function findReceiptCorners(canvas) {
    const small = ImageKit.toCanvas(canvas, 500);
    const scale = canvas.width / small.width;
    const w = small.width;
    const h = small.height;
    const n = w * h;
    const gray = grayOf(small.getContext("2d").getImageData(0, 0, w, h).data, n);
    const t = otsuThreshold(gray);

    // 밝은 픽셀 덩어리 중 가장 큰 것 = 영수증
    const label = new Uint8Array(n); // 0: 아직, 1: 확인함
    const queue = new Int32Array(n);
    let bestPixels = null;

    for (let start = 0; start < n; start++) {
        if (label[start] || gray[start] <= t) continue;
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        label[start] = 1;
        while (head < tail) {
            const p = queue[head++];
            const x = p % w;
            const neighbors = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
            for (let k = 0; k < 4; k++) {
                const q = neighbors[k];
                if (q < 0 || q >= n || label[q] || gray[q] <= t) continue;
                label[q] = 1;
                queue[tail++] = q;
            }
        }
        if (!bestPixels || tail > bestPixels.length) bestPixels = queue.slice(0, tail);
    }

    if (!bestPixels) return null;
    const ratio = bestPixels.length / n;
    // 너무 작으면 영수증이 아니고, 거의 전체면 이미 잘린 사진
    if (ratio < 0.05 || ratio > 0.92) return null;

    // 모서리: x+y가 가장 작은 점이 왼쪽 위, 가장 큰 점이 오른쪽 아래…
    let tl, tr, br, bl;
    let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let k = 0; k < bestPixels.length; k++) {
        const p = bestPixels[k];
        const x = p % w;
        const y = (p - x) / w;
        if (x + y < minSum) { minSum = x + y; tl = [x, y]; }
        if (x + y > maxSum) { maxSum = x + y; br = [x + 1, y + 1]; }
        if (x - y > maxDiff) { maxDiff = x - y; tr = [x + 1, y]; }
        if (x - y < minDiff) { minDiff = x - y; bl = [x, y + 1]; }
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }

    // 영수증이 사진 테두리 3면 이상에 닿으면 이미 꽉 차게 찍힌 것 → 자르지 않음
    const touches = (minX <= 1) + (minY <= 1) + (maxX >= w - 2) + (maxY >= h - 2);
    if (touches >= 3) return null;

    let corners = [tl, tr, br, bl];
    // 네 모서리로 만든 사각형이 영수증 모양과 많이 다르면 (구겨짐, 손가락 등) 그냥 네모 상자로 자르기
    const fill = bestPixels.length / polygonArea(corners);
    if (fill < 0.85 || fill > 1.15) {
        corners = [[minX, minY], [maxX + 1, minY], [maxX + 1, maxY + 1], [minX, maxY + 1]];
    }

    // 테두리에 책상이 얇게 남지 않도록 가운데 쪽으로 1.5% 당기기
    const cx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
    const cy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
    return corners.map(function (c) {
        return [(c[0] + (cx - c[0]) * 0.015) * scale, (c[1] + (cy - c[1]) * 0.015) * scale];
    });
}

function polygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        area += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(area) / 2;
}

function distance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// 결과 사각형의 점 → 원본 사진의 점으로 바꾸는 변환(호모그래피) 계산
function solveHomography(from, to) {
    const A = [];
    for (let i = 0; i < 4; i++) {
        const X = from[i][0], Y = from[i][1], x = to[i][0], y = to[i][1];
        A.push([X, Y, 1, 0, 0, 0, -x * X, -x * Y, x]);
        A.push([0, 0, 0, X, Y, 1, -y * X, -y * Y, y]);
    }
    // 가우스 소거법
    for (let col = 0; col < 8; col++) {
        let pivot = col;
        for (let r = col + 1; r < 8; r++) {
            if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
        }
        [A[col], A[pivot]] = [A[pivot], A[col]];
        for (let r = 0; r < 8; r++) {
            if (r === col) continue;
            const f = A[r][col] / A[col][col];
            for (let c = col; c < 9; c++) A[r][c] -= f * A[col][c];
        }
    }
    return A.map(function (row, i) { return row[8] / row[i]; });
}

// 비스듬한 영수증을 반듯한 직사각형으로 펴기
function warpReceipt(source, corners, outW, outH) {
    const sw = source.width;
    const sh = source.height;
    const src = source.getContext("2d").getImageData(0, 0, sw, sh).data;
    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext("2d");
    const outData = ctx.createImageData(outW, outH);
    const dst = outData.data;

    const H = solveHomography([[0, 0], [outW, 0], [outW, outH], [0, outH]], corners);

    for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
            const X = x + 0.5;
            const Y = y + 0.5;
            const d = H[6] * X + H[7] * Y + 1;
            let sx = (H[0] * X + H[1] * Y + H[2]) / d - 0.5;
            let sy = (H[3] * X + H[4] * Y + H[5]) / d - 0.5;
            sx = Math.min(Math.max(sx, 0), sw - 1.001);
            sy = Math.min(Math.max(sy, 0), sh - 1.001);

            // 주변 4픽셀을 섞어서 부드럽게
            const x0 = Math.floor(sx), y0 = Math.floor(sy);
            const fx = sx - x0, fy = sy - y0;
            const i00 = (y0 * sw + x0) * 4;
            const i10 = i00 + 4;
            const i01 = i00 + sw * 4;
            const i11 = i01 + 4;
            const o = (y * outW + x) * 4;
            for (let c = 0; c < 3; c++) {
                const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
                const bottom = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
                dst[o + c] = top + (bottom - top) * fy;
            }
            dst[o + 3] = 255;
        }
    }
    ctx.putImageData(outData, 0, 0);
    return out;
}

// 그림자·누런 조명 같은 "배경 밝기"를 추정 (글씨는 지우고 종이 밝기만 남김)
function estimateBackground(values, w, h, block) {
    const bw = Math.ceil(w / block);
    const bh = Math.ceil(h / block);
    const sums = new Float32Array(bw * bh);
    const counts = new Float32Array(bw * bh);
    for (let y = 0; y < h; y++) {
        const row = Math.floor(y / block) * bw;
        for (let x = 0; x < w; x++) {
            const b = row + Math.floor(x / block);
            sums[b] += values[y * w + x];
            counts[b]++;
        }
    }
    let grid = sums.map(function (s, i) { return s / counts[i]; });

    // 주변에서 가장 밝은 값 → 글씨(어두움)가 사라지고 종이만 남음
    grid = filterGrid(grid, bw, bh, 3, Math.max);
    // 살짝 부드럽게
    grid = filterGrid(grid, bw, bh, 2, null);
    return { grid: grid, bw: bw, bh: bh, block: block };
}

// reduce가 Math.max면 최대값, null이면 평균
function filterGrid(grid, bw, bh, r, reduce) {
    const out = new Float32Array(grid.length);
    for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
            let acc = reduce ? -Infinity : 0;
            let cnt = 0;
            for (let dy = -r; dy <= r; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= bh) continue;
                for (let dx = -r; dx <= r; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= bw) continue;
                    const v = grid[yy * bw + xx];
                    if (reduce) acc = reduce(acc, v);
                    else acc += v;
                    cnt++;
                }
            }
            out[y * bw + x] = reduce ? acc : acc / cnt;
        }
    }
    return out;
}

// 배경 격자에서 (x, y) 위치 값 읽기 (사이 값은 섞어서)
function sampleBackground(bg, x, y) {
    const gx = Math.min(Math.max((x + 0.5) / bg.block - 0.5, 0), bg.bw - 1);
    const gy = Math.min(Math.max((y + 0.5) / bg.block - 0.5, 0), bg.bh - 1);
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const x1 = Math.min(x0 + 1, bg.bw - 1), y1 = Math.min(y0 + 1, bg.bh - 1);
    const fx = gx - x0, fy = gy - y0;
    const g = bg.grid;
    const top = g[y0 * bg.bw + x0] + (g[y0 * bg.bw + x1] - g[y0 * bg.bw + x0]) * fx;
    const bottom = g[y1 * bg.bw + x0] + (g[y1 * bg.bw + x1] - g[y1 * bg.bw + x0]) * fx;
    return top + (bottom - top) * fy;
}

// 3x3 평균과의 차이를 더해 글씨 테두리를 또렷하게 (언샤프 마스크)
function sharpen(values, w, h, amount) {
    const out = new Float32Array(values.length);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let sum = 0, cnt = 0;
            for (let dy = -1; dy <= 1; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= h) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= w) continue;
                    sum += values[yy * w + xx];
                    cnt++;
                }
            }
            const v = values[y * w + x];
            out[y * w + x] = v + amount * (v - sum / cnt);
        }
    }
    return out;
}

// 배경은 하얗게, 흐린 글씨는 진하게
function whiten(canvas, colorMode, level) {
    const w = canvas.width;
    const h = canvas.height;
    const n = w * h;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const block = Math.max(8, Math.round(Math.max(w, h) / 150));

    // level 1~10 → 종이로 볼 밝기 기준, 글씨 진하게 하는 정도
    const lo = 0.1 + level * 0.02;
    const hi = 0.97 - level * 0.015;
    const gamma = 1 + level * 0.4;
    const sharpAmount = 0.3 + level * 0.06;

    function levels(ratio) {
        const v = Math.min(Math.max((ratio - lo) / (hi - lo), 0), 1);
        return Math.pow(v, gamma) * 255;
    }

    const channels = colorMode ? [0, 1, 2] : [-1];
    const results = channels.map(function (c) {
        const values = new Float32Array(n);
        if (c === -1) {
            const gray = grayOf(data, n);
            for (let p = 0; p < n; p++) values[p] = gray[p];
        } else {
            for (let p = 0; p < n; p++) values[p] = data[p * 4 + c];
        }

        const bg = estimateBackground(values, w, h, block);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const p = y * w + x;
                values[p] = levels(values[p] / Math.max(sampleBackground(bg, x, y), 1));
            }
        }
        return sharpen(values, w, h, sharpAmount);
    });

    for (let p = 0; p < n; p++) {
        const i = p * 4;
        if (colorMode) {
            data[i] = results[0][p];
            data[i + 1] = results[1][p];
            data[i + 2] = results[2][p];
        } else {
            data[i] = data[i + 1] = data[i + 2] = results[0][p];
        }
        data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

function rotateCanvas(canvas, degrees) {
    const turns = ((degrees % 360) + 360) % 360;
    if (turns === 0) return canvas;
    const swap = turns === 90 || turns === 270;
    const out = document.createElement("canvas");
    out.width = swap ? canvas.height : canvas.width;
    out.height = swap ? canvas.width : canvas.height;
    const ctx = out.getContext("2d");
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(turns * Math.PI / 180);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return out;
}

// 영수증 한 장 처리. onStep(설명, 0~1)으로 단계 알려줌
async function processReceipt(file, settings, rotation, onStep) {
    onStep("불러오는 중", 0.05);
    let source = await ImageKit.fileToCanvas(file);
    await ImageKit.nextFrame();

    let corners = null;
    if (settings.crop) {
        onStep("영수증 찾는 중", 0.2);
        corners = findReceiptCorners(source);
        await ImageKit.nextFrame();
    }
    if (!corners) {
        corners = [[0, 0], [source.width, 0], [source.width, source.height], [0, source.height]];
    }

    // 목표 가로 크기에 맞추기 (작은 영수증은 최대 2배까지 키움)
    const receiptW = Math.max(distance(corners[0], corners[1]), distance(corners[3], corners[2]));
    const receiptH = Math.max(distance(corners[0], corners[3]), distance(corners[1], corners[2]));
    const sideways = rotation % 180 !== 0;
    const finalW = sideways ? receiptH : receiptW;
    const scale = settings.width ? Math.min(2, settings.width / finalW) : 1;

    // 많이 줄여야 하면 먼저 부드럽게 줄여 두기 (글씨가 깨지지 않게)
    if (scale < 1) {
        const pre = ImageKit.toCanvas(source, Math.max(source.width, source.height) * scale);
        const k = pre.width / source.width;
        corners = corners.map(function (c) { return [c[0] * k, c[1] * k]; });
        source = pre;
    }
    const k = Math.max(scale, 1);
    const outW = Math.max(1, Math.round(Math.max(distance(corners[0], corners[1]), distance(corners[3], corners[2])) * k));
    const outH = Math.max(1, Math.round(Math.max(distance(corners[0], corners[3]), distance(corners[1], corners[2])) * k));

    onStep(settings.crop ? "반듯하게 펴는 중" : "크기 맞추는 중", 0.4);
    let canvas = warpReceipt(source, corners, outW, outH);
    source = null;
    await ImageKit.nextFrame();

    if (settings.mode !== "none") {
        onStep("하얗고 선명하게 보정 중", 0.6);
        canvas = whiten(canvas, settings.mode === "color", settings.level);
        await ImageKit.nextFrame();
    }

    canvas = rotateCanvas(canvas, rotation);

    onStep("저장 중", 0.9);
    const type = settings.format === "png" ? "image/png" : "image/jpeg";
    const blob = await new Promise(function (resolve) {
        canvas.toBlob(resolve, type, 0.9);
    });
    return { blob: blob, width: canvas.width, height: canvas.height };
}

/* ==================== 목록과 진행 상황 ==================== */

const items = [];
let running = false;
let stopRequested = false;
let runStartedAt = 0;
let runFinished = 0;    // 이번 실행에서 끝낸 장 수 (남은 시간 계산용)
let settingsChanged = false;

function currentSettings() {
    return {
        crop: cropCheck.checked,
        mode: mode,
        level: Number(strength.value),
        width: Number(widthSelect.value),
        format: formatSelect.value
    };
}

function addFiles(files) {
    files.forEach(function (file) {
        const item = {
            file: file,
            name: ImageKit.baseName(file.name),
            status: "pending",
            step: "",
            rotation: 0,
            srcUrl: URL.createObjectURL(file),
            resultUrl: null,
            blob: null,
            size: ""
        };
        item.el = createCard(item);
        items.push(item);
        grid.appendChild(item.el);
    });
    showToast(files.length + "장을 올렸어요");
    updateUi();
    startQueue();

    // 좁은 화면에서는 진행 상황이 설정 아래에 있어서 그쪽으로 이동
    if (window.innerWidth < 900) {
        progressCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function createCard(item) {
    const el = document.createElement("div");
    el.className = "receipt";
    el.innerHTML =
        '<div class="receipt-thumb">' +
        '  <img alt="">' +
        '  <span class="badge"></span>' +
        '  <div class="receipt-tools">' +
        '    <button type="button" data-action="rotate" title="오른쪽으로 돌리기">⟳</button>' +
        '    <button type="button" data-action="remove" title="지우기">✕</button>' +
        "  </div>" +
        "</div>" +
        '<div class="receipt-meta"><span></span><span></span></div>';

    el.querySelector(".receipt-thumb").addEventListener("click", function (event) {
        const btn = event.target.closest("button");
        if (!btn) {
            openViewer(item);
        } else if (btn.dataset.action === "rotate") {
            rotateItem(item);
        } else if (btn.dataset.action === "remove") {
            removeItem(item);
        }
    });
    item.el = el;
    renderCard(item);
    return el;
}

function renderCard(item) {
    const el = item.el;
    const img = el.querySelector("img");
    const badge = el.querySelector(".badge");
    const meta = el.querySelectorAll(".receipt-meta span");

    const src = item.resultUrl || item.srcUrl;
    if (img.getAttribute("src") !== src) img.src = src;
    img.classList.toggle("pending", !item.resultUrl);

    badge.className = "badge " + item.status;
    if (item.status === "pending") badge.textContent = "대기";
    else if (item.status === "working") badge.innerHTML = '<span class="mini-spinner"></span>' + item.step;
    else if (item.status === "done") badge.textContent = "✓ 완료";
    else badge.textContent = "실패: " + item.step;

    meta[0].textContent = item.file.name;
    meta[1].textContent = item.size;
    el.querySelector('[data-action="remove"]').disabled = item.status === "working";
    el.querySelector('[data-action="rotate"]').disabled = item.status === "working";
}

function formatSeconds(sec) {
    sec = Math.max(1, Math.round(sec));
    return sec >= 60 ? Math.floor(sec / 60) + "분 " + (sec % 60) + "초" : sec + "초";
}

function updateUi(current, stepRatio) {
    const total = items.length;
    const finished = items.filter(function (i) { return i.status === "done" || i.status === "failed"; }).length;
    const failed = items.filter(function (i) { return i.status === "failed"; }).length;
    const pending = items.filter(function (i) { return i.status === "pending"; }).length;
    const done = items.filter(function (i) { return i.status === "done"; }).length;

    gridEmpty.hidden = total > 0;
    progressCount.textContent = finished + " / " + total;
    const ratio = total ? (finished + (current ? stepRatio || 0 : 0)) / total : 0;
    progressBar.style.width = Math.round(ratio * 100) + "%";

    progressCard.classList.toggle("working", running);
    progressCard.classList.toggle("done", !running && total > 0 && pending === 0);

    if (total === 0) {
        progressTitle.textContent = "사진을 올리면 바로 처리를 시작해요";
        progressDetail.textContent = "여러 장을 한꺼번에 올려도 괜찮아요";
        progressEta.textContent = "";
    } else if (running) {
        progressTitle.textContent = "영수증 정리 중… 창을 닫지 말아 주세요";
        progressDetail.textContent = current ? current.file.name + " · " + current.step : "";
        // 지금까지 걸린 평균 시간으로 남은 시간 계산
        if (runFinished > 0) {
            const per = (Date.now() - runStartedAt) / runFinished / 1000;
            progressEta.textContent = "약 " + formatSeconds(per * (pending + 1 - (stepRatio || 0))) + " 남음";
        } else {
            progressEta.textContent = "남은 시간 계산 중…";
        }
    } else if (pending > 0) {
        progressTitle.textContent = "⏸ 멈췄어요 · 남은 영수증 " + pending + "장";
        progressDetail.textContent = "\"이어서 처리\"를 누르면 남은 것부터 계속해요";
        progressEta.textContent = "";
    } else {
        progressTitle.textContent = "✅ 모두 끝났어요! " + done + "장 완성";
        progressDetail.textContent = failed
            ? "실패 " + failed + "장은 지우거나 다른 사진으로 올려 주세요"
            : "\"ZIP으로 모두 받기\"를 눌러 내려받으세요";
        progressEta.textContent = "";
    }

    zipButton.disabled = done === 0;
    zipButton.textContent = done ? "📦 ZIP으로 모두 받기 (" + done + "장)" : "📦 ZIP으로 모두 받기";
    stopButton.hidden = !running;
    resumeButton.hidden = running || pending === 0;
    settingsNote.hidden = !(settingsChanged && done > 0 && !running);
}

async function startQueue() {
    if (running) return;
    running = true;
    stopRequested = false;
    runStartedAt = Date.now();
    runFinished = 0;
    updateUi();

    while (!stopRequested) {
        const item = items.find(function (i) { return i.status === "pending"; });
        if (!item) break;

        item.status = "working";
        try {
            const result = await processReceipt(item.file, currentSettings(), item.rotation, function (step, r) {
                item.step = step;
                renderCard(item);
                updateUi(item, r);
            });
            if (items.indexOf(item) < 0) continue; // 처리 중에 지워짐
            if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
            item.blob = result.blob;
            item.resultUrl = URL.createObjectURL(result.blob);
            item.size = result.width + "×" + result.height;
            item.status = "done";
        } catch (error) {
            console.error(error);
            item.status = "failed";
            item.step = "열 수 없는 사진";
        }
        runFinished++;
        renderCard(item);
        updateUi();
    }

    running = false;
    settingsChanged = false;
    updateUi();
    if (!stopRequested && items.length) showToast("영수증 정리가 끝났어요");
}

function rotateItem(item) {
    item.rotation = (item.rotation + 90) % 360;
    item.status = "pending";
    renderCard(item);
    updateUi();
    startQueue();
}

function removeItem(item) {
    if (item.status === "working") return;
    URL.revokeObjectURL(item.srcUrl);
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    item.el.remove();
    items.splice(items.indexOf(item), 1);
    updateUi();
}

// 설정이 바뀌면 다시 처리할 수 있게 안내
function onSettingsChange() {
    settingsChanged = true;
    updateUi();
}

/* ==================== ZIP ==================== */

zipButton.addEventListener("click", async function () {
    const done = items.filter(function (i) { return i.status === "done"; });
    if (!done.length) return;

    zipButton.disabled = true;
    const zip = new JSZip();
    const used = {};
    done.forEach(function (item) {
        const ext = item.blob.type === "image/png" ? ".png" : ".jpg";
        let name = item.name;
        if (used[name]) name += "-" + (++used[item.name]);
        else used[name] = 1;
        zip.file(name + ext, item.blob);
    });

    progressDetail.textContent = "ZIP 파일 만드는 중…";
    const blob = await zip.generateAsync({ type: "blob" }, function (meta) {
        progressDetail.textContent = "ZIP 파일 만드는 중… " + Math.round(meta.percent) + "%";
    });

    const now = new Date();
    const stamp = now.getFullYear() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0");
    ImageKit.downloadBlob(blob, "영수증-" + stamp + "-" + done.length + "장.zip");
    showToast("ZIP 파일을 내려받았어요");
    updateUi();
});

/* ==================== 크게 보기 ==================== */

let viewerItem = null;

function openViewer(item) {
    viewerItem = item;
    viewerName.textContent = item.file.name + (item.size ? " · " + item.size : "");
    viewerToggle.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("active", b.dataset.value === (item.resultUrl ? "after" : "before"));
    });
    viewerImage.src = item.resultUrl || item.srcUrl;
    viewer.hidden = false;
}

function closeViewer() {
    viewer.hidden = true;
    viewerImage.removeAttribute("src");
    viewerItem = null;
}

ImageKit.setupSegmented(viewerToggle, function (value) {
    if (!viewerItem) return;
    viewerImage.src = value === "after" && viewerItem.resultUrl ? viewerItem.resultUrl : viewerItem.srcUrl;
});
viewerClose.addEventListener("click", closeViewer);
viewer.addEventListener("click", function (event) {
    if (event.target === viewer || event.target.classList.contains("viewer-body")) closeViewer();
});
document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !viewer.hidden) closeViewer();
});

/* ==================== 기타 ==================== */

let toastTimer;
function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 2200);
}

function applyMode() {
    modeHelp.textContent = MODE_HELP[mode];
    strengthField.hidden = mode === "none";
}

ImageKit.setupTheme(document.getElementById("themeSelect"));
ImageKit.setupDropzone(dropzone, fileInput, addFiles, true);

ImageKit.setupSegmented(modeSelect, function (value) {
    mode = value;
    applyMode();
    onSettingsChange();
});

strength.addEventListener("input", function () {
    strengthValue.textContent = strength.value;
});
strength.addEventListener("change", onSettingsChange);
cropCheck.addEventListener("change", onSettingsChange);
widthSelect.addEventListener("change", onSettingsChange);
formatSelect.addEventListener("change", onSettingsChange);

reprocessButton.addEventListener("click", function () {
    items.forEach(function (item) {
        if (item.status !== "working") item.status = "pending";
        renderCard(item);
    });
    startQueue();
});

stopButton.addEventListener("click", function () {
    stopRequested = true;
    showToast("지금 하던 영수증까지만 끝내고 멈출게요");
});

resumeButton.addEventListener("click", startQueue);

clearButton.addEventListener("click", function () {
    items.slice().forEach(removeItem);
});

// 처리 중에 창을 닫으려 하면 한 번 더 확인
window.addEventListener("beforeunload", function (event) {
    if (running) {
        event.preventDefault();
        event.returnValue = "";
    }
});

applyMode();
updateUi();
