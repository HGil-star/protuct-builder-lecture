// 이미지 도구 공용 기능: 배경 제거, 여백 자르기, 스타일 변환, PNG 저장, 화면 공통 동작
const ImageKit = (function () {

    // AI 배경 제거 라이브러리 (처음 쓸 때만 불러옴, 모델은 약 100MB라 첫 실행이 느림)
    const AI_LIB_URL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";
    const MAX_SOURCE_SIZE = 2400; // 너무 큰 사진은 이 크기로 줄여서 처리

    /* ========== 캔버스 기본 ========== */

    function createCanvas(width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        return canvas;
    }

    function loadImage(src) {
        return new Promise(function (resolve, reject) {
            const img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error("이미지를 열 수 없어요")); };
            img.src = src;
        });
    }

    // 이미지를 maxSize 안으로 줄여서 캔버스에 그리기
    function toCanvas(source, maxSize) {
        const w = source.naturalWidth || source.width;
        const h = source.naturalHeight || source.height;
        const scale = Math.min(1, maxSize / Math.max(w, h));
        const canvas = createCanvas(w * scale, h * scale);
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        return canvas;
    }

    async function fileToCanvas(file) {
        const url = URL.createObjectURL(file);
        try {
            const img = await loadImage(url);
            return toCanvas(img, MAX_SOURCE_SIZE);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    function cloneCanvas(canvas) {
        const copy = createCanvas(canvas.width, canvas.height);
        copy.getContext("2d").drawImage(canvas, 0, 0);
        return copy;
    }

    function canvasToBlob(canvas) {
        return new Promise(function (resolve) {
            canvas.toBlob(resolve, "image/png");
        });
    }

    function getPixels(canvas) {
        return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    }

    // 사람 눈에 가까운 색 차이 (0 ~ 255)
    function colorDistance(r1, g1, b1, r2, g2, b2) {
        const dr = r1 - r2;
        const dg = g1 - g2;
        const db = b1 - b2;
        return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 3;
    }

    /* ========== 배경 제거 1: AI ========== */

    let aiModule = null;

    async function removeBackgroundAI(canvas, onProgress) {
        if (!aiModule) aiModule = await import(AI_LIB_URL);

        const blob = await canvasToBlob(canvas);
        const result = await aiModule.removeBackground(blob, {
            model: "isnet_fp16",
            output: { format: "image/png" },
            progress: function (key, current, total) {
                if (!onProgress || !total) return;
                if (key.indexOf("fetch") === 0) {
                    onProgress("AI 모델 내려받는 중 (처음 한 번만)", current / total);
                } else {
                    onProgress("AI가 배경을 찾는 중", current / total);
                }
            }
        });

        const url = URL.createObjectURL(result);
        let cut;
        try {
            cut = toCanvas(await loadImage(url), Infinity);
        } finally {
            URL.revokeObjectURL(url);
        }

        // AI가 배경에 남긴 희미한 얼룩(거의 투명한 픽셀)은 완전히 지우기
        const imageData = getPixels(cut);
        const data = imageData.data;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 48) data[i] = 0;
        }
        cut.getContext("2d").putImageData(imageData, 0, 0);
        return cut;
    }

    /* ========== 배경 제거 2: 단색 배경 (빠름) ========== */

    // 테두리에서 가장 많이 보이는 색들을 배경색으로 추정
    function findBackgroundColors(data, w, h) {
        const buckets = new Map();
        let total = 0;

        function add(x, y) {
            const i = (y * w + x) * 4;
            if (data[i + 3] < 128) return;
            const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
            let b = buckets.get(key);
            if (!b) {
                b = { n: 0, r: 0, g: 0, b: 0 };
                buckets.set(key, b);
            }
            b.n++;
            b.r += data[i];
            b.g += data[i + 1];
            b.b += data[i + 2];
            total++;
        }

        for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
        for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }

        const sorted = Array.from(buckets.values()).sort(function (a, b) { return b.n - a.n; });
        const colors = [];
        for (let i = 0; i < sorted.length && colors.length < 4; i++) {
            const b = sorted[i];
            if (colors.length > 0 && b.n < total * 0.08) break;
            colors.push([b.r / b.n, b.g / b.n, b.b / b.n]);
        }
        return colors;
    }

    // 테두리에서 시작해 배경색과 비슷한 픽셀을 번지듯 지우기
    function removeBackgroundColor(source, tolerance) {
        const canvas = cloneCanvas(source);
        const w = canvas.width;
        const h = canvas.height;
        const n = w * h;
        const imageData = getPixels(canvas);
        const data = imageData.data;

        const bgColors = findBackgroundColors(data, w, h);
        if (bgColors.length === 0) return canvas; // 이미 투명한 이미지

        // 픽셀마다 "가장 가까운 배경색과의 차이"
        const distBg = new Float32Array(n);
        for (let p = 0; p < n; p++) {
            const i = p * 4;
            if (data[i + 3] < 128) continue;
            let best = Infinity;
            for (let c = 0; c < bgColors.length; c++) {
                const bc = bgColors[c];
                const d = colorDistance(data[i], data[i + 1], data[i + 2], bc[0], bc[1], bc[2]);
                if (d < best) best = d;
            }
            distBg[p] = best;
        }

        const isBg = new Uint8Array(n);
        const queue = new Int32Array(n);
        let head = 0;
        let tail = 0;

        function seed(p) {
            if (!isBg[p] && distBg[p] < tolerance) {
                isBg[p] = 1;
                queue[tail++] = p;
            }
        }
        for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }

        // 배경색과 비슷하거나, 바로 옆 배경 픽셀과 거의 같은 색(그라데이션·그림자)이면 배경
        while (head < tail) {
            const p = queue[head++];
            const x = p % w;
            const neighbors = [
                x > 0 ? p - 1 : -1,
                x < w - 1 ? p + 1 : -1,
                p - w,
                p + w
            ];
            for (let k = 0; k < 4; k++) {
                const q = neighbors[k];
                if (q < 0 || q >= n || isBg[q]) continue;
                const d = distBg[q];
                let ok = d < tolerance;
                if (!ok && d < tolerance * 1.8) {
                    const i = p * 4;
                    const j = q * 4;
                    ok = colorDistance(data[i], data[i + 1], data[i + 2], data[j], data[j + 1], data[j + 2]) < tolerance * 0.25;
                }
                if (ok) {
                    isBg[q] = 1;
                    queue[tail++] = q;
                }
            }
        }

        // 물체 안쪽에 갇힌 배경 (예: 컵 손잡이 구멍)
        // 컵에 쓰인 흰 글씨 같은 걸 지우지 않도록 배경색과 아주 비슷하고 적당한 크기만 지움
        const minHole = Math.max(64, n * 0.0005);
        const maxHole = n * 0.06;
        const holeLimit = Math.min(tolerance * 0.4, 14);
        const visited = new Uint8Array(n);
        for (let start = 0; start < n; start++) {
            if (isBg[start] || visited[start] || distBg[start] >= holeLimit) continue;

            head = 0;
            tail = 0;
            queue[tail++] = start;
            visited[start] = 1;
            while (head < tail) {
                const p = queue[head++];
                const x = p % w;
                const neighbors = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
                for (let k = 0; k < 4; k++) {
                    const q = neighbors[k];
                    if (q < 0 || q >= n || visited[q] || isBg[q] || distBg[q] >= holeLimit) continue;
                    visited[q] = 1;
                    queue[tail++] = q;
                }
            }
            if (tail >= minHole && tail <= maxHole) {
                for (let k = 0; k < tail; k++) isBg[queue[k]] = 1;
            }
        }

        // 배경은 투명하게, 경계는 살짝 부드럽게
        for (let p = 0; p < n; p++) {
            const i = p * 4;
            if (isBg[p]) {
                data[i + 3] = 0;
                continue;
            }
            const x = p % w;
            const touchesBg =
                (x > 0 && isBg[p - 1]) || (x < w - 1 && isBg[p + 1]) ||
                (p >= w && isBg[p - w]) || (p + w < n && isBg[p + w]);
            if (touchesBg) {
                const soft = Math.min(1, Math.max(0.3, (distBg[p] - tolerance * 0.6) / (tolerance * 0.8)));
                data[i + 3] = Math.round(data[i + 3] * soft);
            }
        }

        canvas.getContext("2d").putImageData(imageData, 0, 0);
        return canvas;
    }

    /* ========== 정리: 잡티 지우기 / 여백 자르기 ========== */

    // 가장 큰 덩어리의 5%보다 작은 조각(먼지, 남은 배경)은 지우기
    function removeSpecks(source) {
        const canvas = cloneCanvas(source);
        const w = canvas.width;
        const h = canvas.height;
        const n = w * h;
        const imageData = getPixels(canvas);
        const data = imageData.data;

        const label = new Int32Array(n).fill(-1);
        const sizes = [];
        const queue = new Int32Array(n);

        for (let start = 0; start < n; start++) {
            if (label[start] !== -1 || data[start * 4 + 3] < 24) continue;

            const id = sizes.length;
            let head = 0;
            let tail = 0;
            queue[tail++] = start;
            label[start] = id;
            while (head < tail) {
                const p = queue[head++];
                const x = p % w;
                const neighbors = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
                for (let k = 0; k < 4; k++) {
                    const q = neighbors[k];
                    if (q < 0 || q >= n || label[q] !== -1 || data[q * 4 + 3] < 24) continue;
                    label[q] = id;
                    queue[tail++] = q;
                }
            }
            sizes.push(tail);
        }

        if (sizes.length <= 1) return canvas;

        const limit = Math.max.apply(null, sizes) * 0.05;
        for (let p = 0; p < n; p++) {
            const id = label[p];
            if (id === -1 ? data[p * 4 + 3] > 0 : sizes[id] < limit) data[p * 4 + 3] = 0;
        }

        canvas.getContext("2d").putImageData(imageData, 0, 0);
        return canvas;
    }

    // 투명한 여백을 잘라내고 padding 만큼만 남기기 (물체가 없으면 null)
    function trimTransparent(canvas, padding) {
        const w = canvas.width;
        const h = canvas.height;
        const data = getPixels(canvas).data;

        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (data[(y * w + x) * 4 + 3] > 8) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) return null;

        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        const out = createCanvas(bw + padding * 2, bh + padding * 2);
        out.getContext("2d").drawImage(canvas, minX, minY, bw, bh, padding, padding, bw, bh);
        return out;
    }

    /* ========== 스타일 변환 도구 ========== */

    // 투명하지 않은 픽셀끼리만 섞는 흐림 (윤곽 색이 배경과 섞이지 않게)
    function blurOpaque(data, w, h, radius) {
        const src = new Float32Array(data);
        const tmp = new Float32Array(w * h * 4);

        function pass(from, to, horizontal) {
            for (let a = 0; a < (horizontal ? h : w); a++) {
                for (let b = 0; b < (horizontal ? w : h); b++) {
                    let r = 0, g = 0, bl = 0, cnt = 0;
                    for (let k = -radius; k <= radius; k++) {
                        const c = b + k;
                        if (c < 0 || c >= (horizontal ? w : h)) continue;
                        const p = horizontal ? a * w + c : c * w + a;
                        if (data[p * 4 + 3] < 128) continue;
                        r += from[p * 4];
                        g += from[p * 4 + 1];
                        bl += from[p * 4 + 2];
                        cnt++;
                    }
                    const p = horizontal ? a * w + b : b * w + a;
                    if (cnt > 0) {
                        to[p * 4] = r / cnt;
                        to[p * 4 + 1] = g / cnt;
                        to[p * 4 + 2] = bl / cnt;
                    }
                }
            }
        }

        pass(src, tmp, true);
        pass(tmp, src, false);
        for (let p = 0; p < w * h; p++) {
            if (data[p * 4 + 3] < 128) continue;
            data[p * 4] = src[p * 4];
            data[p * 4 + 1] = src[p * 4 + 1];
            data[p * 4 + 2] = src[p * 4 + 2];
        }
    }

    // 물체 색을 k개 대표색으로 묶기 (k-평균)
    function findPalette(data, k) {
        const samples = [];
        const total = data.length / 4;
        const step = Math.max(1, Math.floor(total / 20000));
        for (let p = 0; p < total; p += step) {
            const i = p * 4;
            if (data[i + 3] >= 128) samples.push([data[i], data[i + 1], data[i + 2]]);
        }
        if (samples.length === 0) return [[0, 0, 0]];

        // 밝기 순으로 정렬해 고르게 시작점 잡기
        samples.sort(function (a, b) {
            return (a[0] * 3 + a[1] * 6 + a[2]) - (b[0] * 3 + b[1] * 6 + b[2]);
        });
        k = Math.min(k, samples.length);
        let centers = [];
        for (let c = 0; c < k; c++) {
            centers.push(samples[Math.floor((c + 0.5) * samples.length / k)].slice());
        }

        for (let iter = 0; iter < 10; iter++) {
            const sums = centers.map(function () { return [0, 0, 0, 0]; });
            samples.forEach(function (s) {
                const c = nearest(centers, s[0], s[1], s[2]);
                sums[c][0] += s[0];
                sums[c][1] += s[1];
                sums[c][2] += s[2];
                sums[c][3]++;
            });
            centers = centers.map(function (old, c) {
                const s = sums[c];
                return s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : old;
            });
        }
        return centers;
    }

    function nearest(centers, r, g, b) {
        let best = 0;
        let bestD = Infinity;
        for (let c = 0; c < centers.length; c++) {
            const d = colorDistance(r, g, b, centers[c][0], centers[c][1], centers[c][2]);
            if (d < bestD) {
                bestD = d;
                best = c;
            }
        }
        return best;
    }

    function luminance(r, g, b) {
        return r * 0.299 + g * 0.587 + b * 0.114;
    }

    // 실루엣 둘레에 외곽선(테두리) 두르기
    function addOutline(canvas, thickness, color, withShadow) {
        const t = Math.round(thickness);
        const pad = withShadow ? 24 : 0;
        const out = createCanvas(canvas.width + (t + pad) * 2, canvas.height + (t + pad) * 2);
        const ctx = out.getContext("2d");

        if (t > 0) {
            // 실루엣 모양을 외곽선 색으로 칠한 것
            const silhouette = createCanvas(canvas.width, canvas.height);
            const sctx = silhouette.getContext("2d");
            sctx.drawImage(canvas, 0, 0);
            sctx.globalCompositeOperation = "source-in";
            sctx.fillStyle = color;
            sctx.fillRect(0, 0, silhouette.width, silhouette.height);

            // 원을 따라 여러 번 찍어서 두껍게 만들기
            const ring = createCanvas(out.width, out.height);
            const rctx = ring.getContext("2d");
            [1, 0.66, 0.33].forEach(function (ratio) {
                const r = t * ratio;
                const steps = Math.max(16, Math.ceil(2 * Math.PI * r));
                for (let s = 0; s < steps; s++) {
                    const angle = (s / steps) * Math.PI * 2;
                    rctx.drawImage(silhouette, t + pad + Math.cos(angle) * r, t + pad + Math.sin(angle) * r);
                }
            });

            if (withShadow) {
                ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
                ctx.shadowBlur = 16;
                ctx.shadowOffsetY = 6;
            }
            ctx.drawImage(ring, 0, 0);
            ctx.shadowColor = "transparent";
        }

        ctx.drawImage(canvas, t + pad, t + pad);
        return out;
    }

    // 물체 테두리를 매끈하게 (반투명 가장자리를 또렷하게)
    function hardenAlpha(data) {
        for (let i = 3; i < data.length; i += 4) {
            data[i] = data[i] >= 128 ? 255 : 0;
        }
    }

    /* ========== 스타일 1: 플랫 일러스트 ========== */

    function styleFlat(cut, options) {
        const canvas = toCanvas(cut, 800);
        const w = canvas.width;
        const h = canvas.height;
        const imageData = getPixels(canvas);
        const data = imageData.data;

        hardenAlpha(data);
        blurOpaque(data, w, h, 3);
        const palette = findPalette(data, options.colors);

        // 각 픽셀을 가장 가까운 대표색으로
        const index = new Int16Array(w * h).fill(-1);
        for (let p = 0; p < w * h; p++) {
            const i = p * 4;
            if (data[i + 3] === 0) continue;
            const c = nearest(palette, data[i], data[i + 1], data[i + 2]);
            index[p] = c;
            data[i] = palette[c][0];
            data[i + 1] = palette[c][1];
            data[i + 2] = palette[c][2];
        }

        // 밝기 차이가 큰 색 경계에 얇은 선을 넣어 그림 느낌 내기
        const line = hexToRgb(options.outlineColor);
        for (let p = 0; p < w * h; p++) {
            const c = index[p];
            if (c < 0) continue;
            const x = p % w;
            const right = x < w - 1 ? index[p + 1] : -1;
            const down = p + w < w * h ? index[p + w] : -1;
            const lc = luminance(palette[c][0], palette[c][1], palette[c][2]);
            [right, down].forEach(function (o) {
                if (o < 0 || o === c) return;
                if (Math.abs(lc - luminance(palette[o][0], palette[o][1], palette[o][2])) > 45) {
                    const i = p * 4;
                    data[i] = line[0];
                    data[i + 1] = line[1];
                    data[i + 2] = line[2];
                }
            });
        }

        canvas.getContext("2d").putImageData(imageData, 0, 0);
        return addOutline(canvas, options.outline, options.outlineColor, false);
    }

    /* ========== 스타일 2: 라인 드로잉 ========== */

    function styleLine(cut, options) {
        const canvas = toCanvas(cut, 800);
        const w = canvas.width;
        const h = canvas.height;
        const imageData = getPixels(canvas);
        const data = imageData.data;

        hardenAlpha(data);
        blurOpaque(data, w, h, 1);

        const gray = new Float32Array(w * h);
        for (let p = 0; p < w * h; p++) {
            gray[p] = luminance(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
        }

        // detail 1~10: 클수록 약한 경계까지 선으로 그림
        const threshold = 150 - options.detail * 12;
        const line = hexToRgb(options.outlineColor);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const p = y * w + x;
                const i = p * 4;
                if (data[i + 3] === 0) continue;

                let mag = 0;
                if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
                    const gx = -gray[p - w - 1] - 2 * gray[p - 1] - gray[p + w - 1] +
                        gray[p - w + 1] + 2 * gray[p + 1] + gray[p + w + 1];
                    const gy = -gray[p - w - 1] - 2 * gray[p - w] - gray[p - w + 1] +
                        gray[p + w - 1] + 2 * gray[p + w] + gray[p + w + 1];
                    mag = Math.sqrt(gx * gx + gy * gy);
                }

                // 선 강도만큼 선 색, 나머지는 흰색으로 채움
                const s = Math.min(1, Math.max(0, (mag - threshold) / 60));
                data[i] = 255 + (line[0] - 255) * s;
                data[i + 1] = 255 + (line[1] - 255) * s;
                data[i + 2] = 255 + (line[2] - 255) * s;
            }
        }

        canvas.getContext("2d").putImageData(imageData, 0, 0);
        return addOutline(canvas, options.outline, options.outlineColor, false);
    }

    /* ========== 스타일 3: 스티커 ========== */

    function styleSticker(cut, options) {
        const canvas = toCanvas(cut, 800);
        const imageData = getPixels(canvas);
        hardenAlpha(imageData.data);
        canvas.getContext("2d").putImageData(imageData, 0, 0);
        return addOutline(canvas, options.outline, options.outlineColor, true);
    }

    /* ========== 스타일 4: 픽셀 아트 ========== */

    function stylePixel(cut, options) {
        // detail 1~10 → 가로 칸 수 16 ~ 88
        const cols = 8 + options.detail * 8;
        const small = toCanvas(cut, cols);
        const w = small.width;
        const h = small.height;
        const imageData = getPixels(small);
        const data = imageData.data;

        hardenAlpha(data);
        const palette = findPalette(data, options.colors);
        for (let p = 0; p < w * h; p++) {
            const i = p * 4;
            if (data[i + 3] === 0) continue;
            const c = palette[nearest(palette, data[i], data[i + 1], data[i + 2])];
            data[i] = c[0];
            data[i + 1] = c[1];
            data[i + 2] = c[2];
        }

        // 외곽선도 칸 단위로 (두께 1 이상이면 한 칸)
        let grid = small;
        if (options.outline > 0) {
            grid = createCanvas(w + 2, h + 2);
            const gData = grid.getContext("2d").createImageData(w + 2, h + 2);
            const gd = gData.data;
            const line = hexToRgb(options.outlineColor);
            const gw = w + 2;

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;
                    if (data[i + 3] === 0) continue;
                    // 주변 8칸 중 비어 있는 곳에 선 색 칠하기
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const j = ((y + 1 + dy) * gw + (x + 1 + dx)) * 4;
                            if (gd[j + 3] === 0) {
                                gd[j] = line[0];
                                gd[j + 1] = line[1];
                                gd[j + 2] = line[2];
                                gd[j + 3] = 255;
                            }
                        }
                    }
                }
            }
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;
                    if (data[i + 3] === 0) continue;
                    const j = ((y + 1) * gw + (x + 1)) * 4;
                    gd[j] = data[i];
                    gd[j + 1] = data[i + 1];
                    gd[j + 2] = data[i + 2];
                    gd[j + 3] = 255;
                }
            }
            grid.getContext("2d").putImageData(gData, 0, 0);
        } else {
            small.getContext("2d").putImageData(imageData, 0, 0);
        }

        // 칸이 또렷하게 보이도록 크게 키우기
        const scale = Math.max(1, Math.floor(800 / Math.max(grid.width, grid.height)));
        const out = createCanvas(grid.width * scale, grid.height * scale);
        const ctx = out.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(grid, 0, 0, out.width, out.height);
        return out;
    }

    function hexToRgb(hex) {
        const v = parseInt(hex.replace("#", ""), 16);
        return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }

    const styles = {
        flat: styleFlat,
        line: styleLine,
        sticker: styleSticker,
        pixel: stylePixel
    };

    /* ========== 저장 ========== */

    async function downloadPng(canvas, filename) {
        const blob = await canvasToBlob(canvas);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    function baseName(filename) {
        return (filename || "image").replace(/\.[^.]+$/, "");
    }

    /* ========== 화면 공통 동작 ========== */

    // 테마 선택 (로또 페이지와 같은 값을 공유)
    function setupTheme(group) {
        const root = document.documentElement;
        let theme = "auto";
        try {
            theme = localStorage.getItem("site-theme") || "auto";
        } catch (e) { /* 저장소를 못 쓰면 기본값 */ }

        function apply() {
            if (theme === "auto") root.removeAttribute("data-theme");
            else root.setAttribute("data-theme", theme);
            group.querySelectorAll("button").forEach(function (b) {
                b.classList.toggle("active", b.dataset.value === theme);
            });
        }

        group.addEventListener("click", function (event) {
            const target = event.target.closest("button");
            if (!target) return;
            theme = target.dataset.value;
            try {
                localStorage.setItem("site-theme", theme);
            } catch (e) { /* 무시 */ }
            apply();
        });
        apply();
    }

    // 클릭, 끌어다 놓기, 붙여넣기(Ctrl+V)로 이미지 받기
    function setupDropzone(zone, input, onFile) {
        function pick(files) {
            const file = Array.from(files || []).find(function (f) {
                return f.type.indexOf("image/") === 0;
            });
            if (file) onFile(file);
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
            zone.addEventListener(type, function () {
                zone.classList.remove("dragover");
            });
        });
        zone.addEventListener("drop", function (event) {
            event.preventDefault();
            pick(event.dataTransfer.files);
        });

        document.addEventListener("paste", function (event) {
            pick(event.clipboardData && event.clipboardData.files);
        });
    }

    // 세그먼트 버튼 그룹: 선택 바뀌면 onChange(value)
    function setupSegmented(group, onChange) {
        group.addEventListener("click", function (event) {
            const target = event.target.closest("button");
            if (!target || target.classList.contains("active")) return;
            group.querySelectorAll("button").forEach(function (b) {
                b.classList.toggle("active", b === target);
            });
            onChange(target.dataset.value);
        });
    }

    // 캔버스를 미리보기 칸에 넣기
    function showCanvas(box, canvas) {
        box.innerHTML = "";
        box.appendChild(canvas);
    }

    // 무거운 작업 전에 화면이 먼저 그려지도록 잠깐 양보
    function nextFrame() {
        return new Promise(function (resolve) {
            requestAnimationFrame(function () { setTimeout(resolve, 0); });
        });
    }

    return {
        fileToCanvas: fileToCanvas,
        cloneCanvas: cloneCanvas,
        removeBackgroundAI: removeBackgroundAI,
        removeBackgroundColor: removeBackgroundColor,
        removeSpecks: removeSpecks,
        trimTransparent: trimTransparent,
        styles: styles,
        downloadPng: downloadPng,
        baseName: baseName,
        setupTheme: setupTheme,
        setupDropzone: setupDropzone,
        setupSegmented: setupSegmented,
        showCanvas: showCanvas,
        nextFrame: nextFrame
    };
})();
