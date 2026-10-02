const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const methodSelect = document.getElementById("methodSelect");
const methodHelp = document.getElementById("methodHelp");
const toleranceField = document.getElementById("toleranceField");
const tolerance = document.getElementById("tolerance");
const toleranceValue = document.getElementById("toleranceValue");
const trimCheck = document.getElementById("trimCheck");
const speckCheck = document.getElementById("speckCheck");
const paddingField = document.getElementById("paddingField");
const padding = document.getElementById("padding");
const paddingValue = document.getElementById("paddingValue");
const downloadButton = document.getElementById("downloadButton");
const sourceBox = document.getElementById("sourceBox");
const resultBox = document.getElementById("resultBox");
const sourceSize = document.getElementById("sourceSize");
const resultSize = document.getElementById("resultSize");
const statusBox = document.getElementById("status");
const statusText = document.getElementById("statusText");
const progressBar = document.getElementById("progressBar");

const METHOD_HELP = {
    ai: "복잡한 배경도 잘 지워요. 처음 한 번은 AI 모델(약 100MB)을 내려받아요.",
    color: "흰 벽, 단색 천처럼 배경이 한 가지 색일 때 빠르고 깔끔해요."
};

let method = "ai";
let fileName = "image";
let sourceCanvas = null;  // 올린 원본
let cutCanvas = null;     // 배경만 지운 상태 (여백 자르기 전)
let cleanCanvas = null;   // 잡티까지 지운 상태 (여백 슬라이더 움직일 때 재사용)
let resultCanvas = null;  // 최종 결과
let jobId = 0;            // 처리 중에 새 작업이 시작되면 이전 결과는 버리기

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

// 배경 지우기 (방식이나 범위를 바꾸면 다시 실행)
async function processBackground() {
    if (!sourceCanvas) return;
    const myJob = ++jobId;
    downloadButton.disabled = true;

    let cut;
    try {
        if (method === "ai") {
            setStatus("AI 준비 중…", 0);
            cut = await ImageKit.removeBackgroundAI(sourceCanvas, function (label, ratio) {
                if (myJob === jobId) setStatus(label, ratio);
            });
        } else {
            setStatus("배경 지우는 중…", 0.5);
            await ImageKit.nextFrame();
            cut = ImageKit.removeBackgroundColor(sourceCanvas, Number(tolerance.value));
        }
    } catch (error) {
        console.error(error);
        if (myJob !== jobId) return;
        // AI를 못 쓰는 환경이면 단색 배경 방식으로 대신 처리
        setStatus("AI를 불러오지 못해서 단색 배경 방식으로 처리했어요. (인터넷 연결을 확인해 주세요)", undefined, true);
        cut = ImageKit.removeBackgroundColor(sourceCanvas, Number(tolerance.value));
        if (myJob !== jobId) return;
        setCut(cut);
        return;
    }

    if (myJob !== jobId) return;
    setStatus("");
    setCut(cut);
}

function setCut(cut) {
    cutCanvas = cut;
    updateClean();
}

// 잡티 지우기는 무거워서 결과를 저장해 두기
function updateClean() {
    if (!cutCanvas) return;
    cleanCanvas = speckCheck.checked ? ImageKit.removeSpecks(cutCanvas) : cutCanvas;
    renderResult();
}

// 여백 자르기 (빠르니까 옵션 바뀔 때마다 바로)
function renderResult() {
    if (!cleanCanvas) return;

    let canvas = cleanCanvas;
    if (trimCheck.checked) {
        canvas = ImageKit.trimTransparent(canvas, Number(padding.value));
    }

    if (!canvas) {
        resultCanvas = null;
        resultBox.innerHTML = '<span class="empty">물체를 찾지 못했어요</span>';
        resultSize.textContent = "";
        downloadButton.disabled = true;
        setStatus("배경 인식 범위를 낮추거나 다른 방식을 써 보세요.", undefined, true);
        return;
    }

    resultCanvas = canvas;
    ImageKit.showCanvas(resultBox, ImageKit.cloneCanvas(canvas));
    resultSize.textContent = sizeText(canvas);
    downloadButton.disabled = false;
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
    cutCanvas = null;
    cleanCanvas = null;
    resultCanvas = null;
    resultSize.textContent = "";
    resultBox.innerHTML = '<span class="empty">처리 중…</span>';
    processBackground();
}

/* ========== 이벤트 연결 ========== */

ImageKit.setupTheme(document.getElementById("themeSelect"));
ImageKit.setupDropzone(dropzone, fileInput, handleFile);

ImageKit.setupSegmented(methodSelect, function (value) {
    method = value;
    methodHelp.textContent = METHOD_HELP[value];
    toleranceField.hidden = value !== "color";
    processBackground();
});

tolerance.addEventListener("input", function () {
    toleranceValue.textContent = tolerance.value;
});
tolerance.addEventListener("change", processBackground); // 손을 뗐을 때만 다시 계산

padding.addEventListener("input", function () {
    paddingValue.textContent = padding.value + "px";
    renderResult();
});

trimCheck.addEventListener("change", function () {
    paddingField.hidden = !trimCheck.checked;
    renderResult();
});
speckCheck.addEventListener("change", updateClean);

downloadButton.addEventListener("click", function () {
    if (resultCanvas) ImageKit.downloadPng(resultCanvas, fileName + "-누끼.png");
});
