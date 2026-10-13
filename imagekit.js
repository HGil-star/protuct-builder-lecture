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

    /* ========== 기울어진 직사각형 펴기 ========== */

    // 결과 사각형의 점 → 원본의 점으로 바꾸는 변환(호모그래피) 계산
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

    function cross(o, a, b) {
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    }

    function triangleArea(a, b, c) {
        return Math.abs(cross(a, b, c)) / 2;
    }

    function polygonArea(points) {
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            area += a[0] * b[1] - b[0] * a[1];
        }
        return area / 2; // 화면 좌표(y 아래)에서 시계 방향이면 양수
    }

    // 두 직선 (a1-a2), (b1-b2)의 교점 (평행하면 null)
    function lineIntersection(a1, a2, b1, b2) {
        const d = (a2[0] - a1[0]) * (b2[1] - b1[1]) - (a2[1] - a1[1]) * (b2[0] - b1[0]);
        if (Math.abs(d) < 1e-9) return null;
        const t = ((b1[0] - a1[0]) * (b2[1] - b1[1]) - (b1[1] - a1[1]) * (b2[0] - b1[0])) / d;
        return [a1[0] + t * (a2[0] - a1[0]), a1[1] + t * (a2[1] - a1[1])];
    }

    // 물체(불투명 부분)를 감싸는 사각형의 네 꼭짓점 [좌상, 우상, 우하, 좌하] (직사각형 모양이 아니면 null)
    function findObjectQuad(canvas) {
        const w = canvas.width;
        const h = canvas.height;
        const data = getPixels(canvas).data;

        // 줄마다 가장 왼쪽·오른쪽 픽셀만 모아도 볼록 껍질은 같음
        const points = [];
        let filled = 0;
        for (let y = 0; y < h; y++) {
            let left = -1, right = -1;
            for (let x = 0; x < w; x++) {
                if (data[(y * w + x) * 4 + 3] >= 128) {
                    if (left < 0) left = x;
                    right = x;
                    filled++;
                }
            }
            if (left >= 0) {
                points.push([left, y], [right + 1, y], [left, y + 1], [right + 1, y + 1]);
            }
        }
        if (points.length < 8) return null;

        // 볼록 껍질 (모노톤 체인)
        points.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
        const lower = [];
        const upper = [];
        for (let i = 0; i < points.length; i++) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], points[i]) <= 0) lower.pop();
            lower.push(points[i]);
        }
        for (let i = points.length - 1; i >= 0; i--) {
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], points[i]) <= 0) upper.pop();
            upper.push(points[i]);
        }
        let hull = lower.slice(0, -1).concat(upper.slice(0, -1));
        if (polygonArea(hull) < 0) hull.reverse();
        if (hull.length < 4) return null;

        // 변 하나를 없애고 양옆 변을 늘려 만나게 하기를 반복 → 껍질을 감싸는 사각형
        // (둥근 모서리도 바깥 꼭짓점으로 잡힘) 늘어나는 넓이가 가장 작은 변부터 없앰
        while (hull.length > 4) {
            const n = hull.length;
            let best = -1, bestArea = Infinity, bestPoint = null;
            for (let i = 0; i < n; i++) {
                const p0 = hull[(i - 1 + n) % n], p1 = hull[i], p2 = hull[(i + 1) % n], p3 = hull[(i + 2) % n];
                const x = lineIntersection(p0, p1, p2, p3);
                // 교점이 변의 바깥쪽에 있어야 감싸는 모양이 됨
                if (!x || cross(p1, p2, x) > 0) continue;
                const added = triangleArea(p1, x, p2);
                if (added < bestArea) { bestArea = added; best = i; bestPoint = x; }
            }
            if (best < 0) return null;
            const next = [];
            for (let j = 0; j < n; j++) {
                if (j === best) next.push(bestPoint);
                else if (j !== (best + 1) % n) next.push(hull[j]);
            }
            hull = next;
        }

        // 사각형이 물체를 너무 헐겁게 감싸면 직사각형 물체가 아님
        const quadArea = polygonArea(hull);
        if (quadArea <= 0 || filled / quadArea < 0.85) return null;

        // 모서리가 직각에서 너무 벗어나면 (삼각형, 마름모 등) 직사각형 물체가 아님
        for (let i = 0; i < 4; i++) {
            const p = hull[(i + 3) % 4], q = hull[i], r = hull[(i + 1) % 4];
            const ax = p[0] - q[0], ay = p[1] - q[1], bx = r[0] - q[0], by = r[1] - q[1];
            const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
            if (Math.abs(cos) > 0.7) return null; // 약 45° ~ 135° 밖
        }
        // 마주 보는 변의 길이가 너무 다르면 (삼각형처럼 한 변이 아주 짧으면) 아님
        for (let i = 0; i < 2; i++) {
            const a = Math.hypot(hull[i + 1][0] - hull[i][0], hull[i + 1][1] - hull[i][1]);
            const b = Math.hypot(hull[(i + 3) % 4][0] - hull[i + 2][0], hull[(i + 3) % 4][1] - hull[i + 2][1]);
            if (Math.min(a, b) < Math.max(a, b) * 0.5) return null;
        }

        // x+y가 가장 작은 점을 좌상으로 두고 시계 방향 정렬
        let start = 0;
        for (let i = 1; i < 4; i++) {
            if (hull[i][0] + hull[i][1] < hull[start][0] + hull[start][1]) start = i;
        }
        return hull.slice(start).concat(hull.slice(0, start));
    }

    // 비스듬히 찍힌 직사각형 물체를 반듯한 직사각형으로 펴기 (못 찾으면 null)
    function straightenRect(source) {
        const corners = findObjectQuad(source);
        if (!corners) return null;

        function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
        let outW = Math.max(dist(corners[0], corners[1]), dist(corners[3], corners[2]));
        let outH = Math.max(dist(corners[0], corners[3]), dist(corners[1], corners[2]));
        const k = Math.min(1, MAX_SOURCE_SIZE / Math.max(outW, outH));
        outW = Math.max(1, Math.round(outW * k));
        outH = Math.max(1, Math.round(outH * k));

        const sw = source.width;
        const sh = source.height;
        const src = getPixels(source).data;
        const out = createCanvas(outW, outH);
        const ctx = out.getContext("2d");
        const outData = ctx.createImageData(outW, outH);
        const dst = outData.data;
        const H = solveHomography([[0, 0], [outW, 0], [outW, outH], [0, outH]], corners);

        function px(x, y, c) {
            if (x < 0 || y < 0 || x >= sw || y >= sh) return 0;
            const i = (y * sw + x) * 4;
            return c === 3 ? src[i + 3] : src[i + c] * src[i + 3] / 255; // 투명 테두리가 검게 번지지 않게
        }

        for (let y = 0; y < outH; y++) {
            for (let x = 0; x < outW; x++) {
                const X = x + 0.5;
                const Y = y + 0.5;
                const d = H[6] * X + H[7] * Y + 1;
                const sx = (H[0] * X + H[1] * Y + H[2]) / d - 0.5;
                const sy = (H[3] * X + H[4] * Y + H[5]) / d - 0.5;
                const x0 = Math.floor(sx), y0 = Math.floor(sy);
                const fx = sx - x0, fy = sy - y0;
                const o = (y * outW + x) * 4;
                const v = [0, 0, 0, 0];
                for (let c = 0; c < 4; c++) {
                    const top = px(x0, y0, c) + (px(x0 + 1, y0, c) - px(x0, y0, c)) * fx;
                    const bottom = px(x0, y0 + 1, c) + (px(x0 + 1, y0 + 1, c) - px(x0, y0 + 1, c)) * fx;
                    v[c] = top + (bottom - top) * fy;
                }
                const a = v[3];
                if (a > 0) {
                    dst[o] = v[0] * 255 / a;
                    dst[o + 1] = v[1] * 255 / a;
                    dst[o + 2] = v[2] * 255 / a;
                    dst[o + 3] = a;
                }
            }
        }
        ctx.putImageData(outData, 0, 0);
        return out;
    }

    /* ========== 저장 ========== */

    async function downloadPng(canvas, filename) {
        downloadBlob(await canvasToBlob(canvas), filename);
    }

    function downloadBlob(blob, filename) {
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
    // multiple이 true면 onFile에 이미지 파일 배열을, 아니면 첫 파일 하나를 넘김
    function setupDropzone(zone, input, onFile, multiple) {
        function pick(files) {
            const images = Array.from(files || []).filter(function (f) {
                return f.type.indexOf("image/") === 0;
            });
            if (images.length === 0) return;
            onFile(multiple ? images : images[0]);
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

        // 올리기 칸 밖(미리보기 등)에 놓아도 브라우저가 사진을 열고 페이지를 떠나지 않고 그대로 받기
        function hasFiles(event) {
            return Array.from((event.dataTransfer && event.dataTransfer.types) || []).indexOf("Files") >= 0;
        }
        window.addEventListener("dragover", function (event) {
            if (!event.defaultPrevented && hasFiles(event)) event.preventDefault();
        });
        window.addEventListener("drop", function (event) {
            if (event.defaultPrevented || !hasFiles(event)) return;
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
        loadImage: loadImage,
        toCanvas: toCanvas,
        canvasToBlob: canvasToBlob,
        downloadBlob: downloadBlob,
        fileToCanvas: fileToCanvas,
        cloneCanvas: cloneCanvas,
        removeBackgroundAI: removeBackgroundAI,
        removeBackgroundColor: removeBackgroundColor,
        removeSpecks: removeSpecks,
        trimTransparent: trimTransparent,
        solveHomography: solveHomography,
        straightenRect: straightenRect,
        downloadPng: downloadPng,
        baseName: baseName,
        setupTheme: setupTheme,
        setupDropzone: setupDropzone,
        setupSegmented: setupSegmented,
        showCanvas: showCanvas,
        nextFrame: nextFrame
    };
})();
