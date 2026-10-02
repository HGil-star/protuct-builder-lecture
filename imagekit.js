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
        downloadPng: downloadPng,
        baseName: baseName,
        setupTheme: setupTheme,
        setupDropzone: setupDropzone,
        setupSegmented: setupSegmented,
        showCanvas: showCanvas,
        nextFrame: nextFrame
    };
})();
