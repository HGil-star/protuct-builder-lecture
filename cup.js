const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const styleSelect = document.getElementById("styleSelect");
const styleHelp = document.getElementById("styleHelp");
const methodSelect = document.getElementById("methodSelect");
const colorsField = document.getElementById("colorsField");
const colors = document.getElementById("colors");
const colorsValue = document.getElementById("colorsValue");
const detailField = document.getElementById("detailField");
const detailLabel = document.getElementById("detailLabel");
const detail = document.getElementById("detail");
const detailValue = document.getElementById("detailValue");
const outline = document.getElementById("outline");
const outlineValue = document.getElementById("outlineValue");
const outlineColor = document.getElementById("outlineColor");
const downloadButton = document.getElementById("downloadButton");
const sourceBox = document.getElementById("sourceBox");
const resultBox = document.getElementById("resultBox");
const sourceSize = document.getElementById("sourceSize");
const resultSize = document.getElementById("resultSize");
const statusBox = document.getElementById("status");
const statusText = document.getElementById("statusText");
const progressBar = document.getElementById("progressBar");

// 스타일별 설명과 어울리는 기본값
const STYLE_INFO = {
    flat: {
        help: "색을 몇 가지로 단순하게 묶은 깔끔한 일러스트예요.",
        colors: true, detail: null, outline: 6, color: "#2b2118"
    },
    line: {
        help: "흰 바탕에 선으로 그린 드로잉이에요. 색칠 공부용으로도 좋아요.",
        colors: false, detail: "선 세밀함", outline: 5, color: "#1f2937"
    },
    sticker: {
        help: "원본 컵에 두꺼운 테두리와 그림자를 넣은 스티커예요.",
        colors: false, detail: null, outline: 14, color: "#ffffff"
    },
    pixel: {
        help: "게임 속 아이템 같은 도트 그림이에요.",
        colors: true, detail: "픽셀 촘촘함", outline: 1, color: "#1f1a17"
    }
};

const PADDING = 16; // 결과 이미지 둘레에 남길 투명 여백

let style = "flat";
let method = "ai";
let fileName = "cup";
let sourceCanvas = null;  // 올린 원본
let cupCanvas = null;     // 배경 지우고 컵만 잘라낸 것 (스타일 바꿀 때 재사용)
let resultCanvas = null;
let extractJob = 0;  // 처리 중에 새 사진이 오면 이전 결과는 버리기
let renderJob = 0;

function setStatus(text, ratio, isError) {
    statusBox.hidden = !text;
    statusText.textContent = text || "";
    statusBox.classList.toggle("error", !!isError);
    progressBar.parentElement.hidden = ratio === undefined;
    progressBar.style.width = Math.round((ratio || 0) * 100) + "%";
}

function sizeText(canvas) {
    return canvas.width + " × " + canvas.height;
}

// 1단계: 배경 지우고 컵만 남기기
async function extractCup() {
    if (!sourceCanvas) return;
    const myJob = ++extractJob;
    downloadButton.disabled = true;
    resultBox.innerHTML = '<span class="empty">처리 중…</span>';

    let cut;
    try {
        if (method === "ai") {
            setStatus("AI 준비 중…", 0);
            cut = await ImageKit.removeBackgroundAI(sourceCanvas, function (label, ratio) {
                if (myJob === extractJob) setStatus(label, ratio);
            });
        } else {
            setStatus("배경 지우는 중…", 0.5);
            await ImageKit.nextFrame();
            cut = ImageKit.removeBackgroundColor(sourceCanvas, 40);
        }
        if (myJob !== extractJob) return;
        setStatus("");
    } catch (error) {
        console.error(error);
        if (myJob !== extractJob) return;
        setStatus("AI를 불러오지 못해서 단색 배경 방식으로 처리했어요. (인터넷 연결을 확인해 주세요)", undefined, true);
        cut = ImageKit.removeBackgroundColor(sourceCanvas, 40);
    }

    cupCanvas = ImageKit.trimTransparent(ImageKit.removeSpecks(cut), 0);
    if (!cupCanvas) {
        resultBox.innerHTML = '<span class="empty">컵을 찾지 못했어요</span>';
        setStatus("배경 제거 방식을 바꿔서 다시 해 보세요.", undefined, true);
        return;
    }
    renderStyle();
}

// 2단계: 컵을 고른 스타일로 그리기
async function renderStyle() {
    if (!cupCanvas) return;
    const myJob = ++renderJob;

    await ImageKit.nextFrame();
    if (myJob !== renderJob) return;

    const drawn = ImageKit.styles[style](cupCanvas, {
        colors: Number(colors.value),
        detail: Number(detail.value),
        outline: Number(outline.value),
        outlineColor: outlineColor.value
    });
    const canvas = ImageKit.trimTransparent(drawn, PADDING);
    if (!canvas) return;

    resultCanvas = canvas;
    ImageKit.showCanvas(resultBox, ImageKit.cloneCanvas(canvas));
    resultSize.textContent = sizeText(canvas);
    downloadButton.disabled = false;
}

// 슬라이더를 움직이는 동안 너무 자주 그리지 않게
let renderTimer;
function renderSoon() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderStyle, 120);
}

function applyStyleInfo() {
    const info = STYLE_INFO[style];
    styleHelp.textContent = info.help;
    colorsField.hidden = !info.colors;
    detailField.hidden = !info.detail;
    detailLabel.textContent = info.detail || "";
    outline.value = info.outline;
    outlineValue.textContent = info.outline + "px";
    outlineColor.value = info.color;
}

async function handleFile(file) {
    fileName = ImageKit.baseName(file.name);
    try {
        sourceCanvas = await ImageKit.fileToCanvas(file);
    } catch (error) {
        setStatus(error.message, undefined, true);
        return;
    }

    ImageKit.showCanvas(sourceBox, ImageKit.cloneCanvas(sourceCanvas));
    sourceSize.textContent = sizeText(sourceCanvas);
    cupCanvas = null;
    resultCanvas = null;
    resultSize.textContent = "";
    extractCup();
}

/* ========== 이벤트 연결 ========== */

ImageKit.setupTheme(document.getElementById("themeSelect"));
ImageKit.setupDropzone(dropzone, fileInput, handleFile);

ImageKit.setupSegmented(styleSelect, function (value) {
    style = value;
    applyStyleInfo();
    renderStyle();
});

ImageKit.setupSegmented(methodSelect, function (value) {
    method = value;
    extractCup();
});

colors.addEventListener("input", function () {
    colorsValue.textContent = colors.value;
    renderSoon();
});

detail.addEventListener("input", function () {
    detailValue.textContent = detail.value;
    renderSoon();
});

outline.addEventListener("input", function () {
    outlineValue.textContent = outline.value + "px";
    renderSoon();
});

outlineColor.addEventListener("input", renderSoon);

downloadButton.addEventListener("click", function () {
    if (resultCanvas) ImageKit.downloadPng(resultCanvas, fileName + "-컵툰-" + style + ".png");
});

applyStyleInfo();
