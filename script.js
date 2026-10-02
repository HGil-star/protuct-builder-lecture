const root = document.documentElement;

const themeSelect = document.getElementById("themeSelect");
const layoutSelect = document.getElementById("layoutSelect");
const gameSelect = document.getElementById("gameSelect");

const drawButton = document.getElementById("drawButton");
const copyButton = document.getElementById("copyButton");
const resetButton = document.getElementById("resetButton");
const clearPickButton = document.getElementById("clearPickButton");

const resultsBox = document.getElementById("results");
const countDisplay = document.getElementById("count");
const historyList = document.getElementById("historyList");
const numberGrid = document.getElementById("numberGrid");
const statSum = document.getElementById("statSum");
const statOddEven = document.getElementById("statOddEven");
const statLowHigh = document.getElementById("statLowHigh");
const toast = document.getElementById("toast");

const MAX_NUMBER = 45;
const PICK_COUNT = 6;
const MAX_FIXED = 5;
const MAX_HISTORY = 10; // 기록은 최근 10게임까지만 표시
const BALL_DELAY = 120; // 공이 하나씩 나오는 간격 (ms)
const PC_MIN_WIDTH = 900; // 자동 모드에서 이 너비 이상이면 PC 화면

let games = 1;
let count = 0;
let history = [];
let currentResults = [];
let isDrawing = false;

const fixedNumbers = new Set();
const excludedNumbers = new Set();
const frequency = new Array(MAX_NUMBER + 1).fill(0); // 번호별 뽑힌 횟수

/* ========== 설정 저장 (브라우저에 기억) ========== */

function loadSetting(key, fallback) {
    try {
        return localStorage.getItem(key) || fallback;
    } catch (e) {
        return fallback;
    }
}

function saveSetting(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        // 저장이 막힌 환경이면 그냥 넘어감
    }
}

// 세그먼트 버튼 중 선택된 것 표시
function markActive(group, value) {
    group.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("active", b.dataset.value === value);
    });
}

/* ========== 테마 (자동 / 라이트 / 다크) ========== */

let theme = loadSetting("lotto-theme", "auto");

function applyTheme() {
    if (theme === "auto") {
        root.removeAttribute("data-theme");
    } else {
        root.setAttribute("data-theme", theme);
    }
    markActive(themeSelect, theme);
}

/* ========== 화면 모드 (자동 / PC / 모바일) ========== */

let layout = loadSetting("lotto-layout", "auto");
const wideScreen = window.matchMedia("(min-width: " + PC_MIN_WIDTH + "px)");

function applyLayout() {
    const isPc = layout === "pc" || (layout === "auto" && wideScreen.matches);
    root.classList.toggle("layout-pc", isPc);
    root.classList.toggle("layout-mobile", !isPc);
    markActive(layoutSelect, layout);
}

wideScreen.addEventListener("change", applyLayout);

/* ========== 번호 뽑기 ========== */

function shuffle(array) {
    // 피셔-예이츠 셔플
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 한 게임 = 번호 6개(오름차순) + 보너스 1개
// 고정 번호는 반드시 넣고, 제외 번호는 보너스까지 포함해 절대 안 나옴
function drawGame() {
    const pool = [];
    for (let n = 1; n <= MAX_NUMBER; n++) {
        if (!fixedNumbers.has(n) && !excludedNumbers.has(n)) pool.push(n);
    }
    shuffle(pool);

    const need = PICK_COUNT - fixedNumbers.size;
    const numbers = Array.from(fixedNumbers).concat(pool.slice(0, need));
    numbers.sort(function (a, b) { return a - b; });

    return { numbers: numbers, bonus: pool[need] };
}

// 실제 로또 공 색상 구간
function colorClass(n) {
    if (n <= 10) return "c1";
    if (n <= 20) return "c2";
    if (n <= 30) return "c3";
    if (n <= 40) return "c4";
    return "c5";
}

function createBall(n, small) {
    const ball = document.createElement("span");
    ball.className = "ball " + colorClass(n) + (small ? " small" : "");
    ball.textContent = n;
    return ball;
}

function gameLabel(index) {
    return String.fromCharCode(65 + index); // A, B, C...
}

function draw() {
    if (isDrawing) return;
    isDrawing = true;
    drawButton.disabled = true;

    currentResults = [];
    for (let i = 0; i < games; i++) currentResults.push(drawGame());

    resultsBox.innerHTML = "";
    let delay = 0;

    currentResults.forEach(function (game, index) {
        const row = document.createElement("div");
        row.className = "game-row";

        const label = document.createElement("span");
        label.className = "game-label";
        label.textContent = gameLabel(index);
        row.appendChild(label);

        const balls = document.createElement("div");
        balls.className = "balls";

        game.numbers.forEach(function (n) {
            const ball = createBall(n);
            if (fixedNumbers.has(n)) ball.classList.add("is-fixed");
            ball.style.animationDelay = delay + "ms";
            delay += BALL_DELAY;
            balls.appendChild(ball);
        });

        const plus = document.createElement("span");
        plus.className = "plus";
        plus.textContent = "+";
        balls.appendChild(plus);

        const bonus = createBall(game.bonus);
        bonus.classList.add("bonus");
        bonus.style.animationDelay = delay + "ms";
        delay += BALL_DELAY;
        balls.appendChild(bonus);

        row.appendChild(balls);
        resultsBox.appendChild(row);
    });

    // 모든 공이 나온 뒤 마무리
    setTimeout(function () {
        count++;
        countDisplay.textContent = "뽑은 기록 · " + count + "회";

        currentResults.forEach(function (game) {
            game.numbers.forEach(function (n) { frequency[n]++; });
        });

        history = currentResults.concat(history).slice(0, MAX_HISTORY);
        renderHistory();
        renderStats(currentResults[0]);
        renderGrid();

        copyButton.disabled = false;
        drawButton.disabled = false;
        isDrawing = false;
    }, delay + 200);
}

// A 게임의 합계 / 홀짝 / 저고(1~22 저, 23~45 고) 분석
function renderStats(game) {
    if (!game) {
        statSum.textContent = "-";
        statOddEven.textContent = "-";
        statLowHigh.textContent = "-";
        return;
    }

    let sum = 0;
    let odd = 0;
    let low = 0;
    game.numbers.forEach(function (n) {
        sum += n;
        if (n % 2 === 1) odd++;
        if (n <= 22) low++;
    });

    statSum.textContent = sum;
    statOddEven.textContent = odd + " : " + (PICK_COUNT - odd);
    statLowHigh.textContent = low + " : " + (PICK_COUNT - low);
}

function renderHistory() {
    historyList.innerHTML = "";

    if (history.length === 0) {
        historyList.innerHTML = '<li class="empty">아직 뽑은 번호가 없어요</li>';
        return;
    }

    history.forEach(function (game) {
        const item = document.createElement("li");
        game.numbers.forEach(function (n) {
            item.appendChild(createBall(n, true));
        });

        const plus = document.createElement("span");
        plus.className = "plus";
        plus.textContent = "+";
        item.appendChild(plus);
        item.appendChild(createBall(game.bonus, true));

        historyList.appendChild(item);
    });
}

/* ========== 번호 고정 / 제외 ========== */

function renderGrid() {
    numberGrid.innerHTML = "";

    for (let n = 1; n <= MAX_NUMBER; n++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cell " + colorClass(n);
        cell.dataset.number = n;

        if (fixedNumbers.has(n)) cell.classList.add("fixed");
        if (excludedNumbers.has(n)) cell.classList.add("excluded");

        const num = document.createElement("span");
        num.className = "cell-num";
        num.textContent = n;

        const freq = document.createElement("span");
        freq.className = "cell-freq";
        freq.textContent = frequency[n] > 0 ? frequency[n] + "회" : "";

        cell.appendChild(num);
        cell.appendChild(freq);
        numberGrid.appendChild(cell);
    }
}

// 선택 안 함 → 고정 → 제외 → 선택 안 함
function toggleNumber(n) {
    if (fixedNumbers.has(n)) {
        fixedNumbers.delete(n);
        // 남은 번호가 부족하면 제외할 수 없음 (번호 6개 + 보너스 1개는 있어야 함)
        if (MAX_NUMBER - excludedNumbers.size - 1 >= PICK_COUNT + 1) {
            excludedNumbers.add(n);
        } else {
            showToast("더 이상 제외할 수 없어요");
        }
    } else if (excludedNumbers.has(n)) {
        excludedNumbers.delete(n);
    } else if (fixedNumbers.size < MAX_FIXED) {
        fixedNumbers.add(n);
    } else if (MAX_NUMBER - excludedNumbers.size - 1 >= PICK_COUNT + 1) {
        showToast("고정은 최대 " + MAX_FIXED + "개까지라 제외로 설정했어요");
        excludedNumbers.add(n);
    } else {
        showToast("더 이상 선택할 수 없어요");
    }
    renderGrid();
}

/* ========== 기타 ========== */

function copyResults() {
    if (currentResults.length === 0) return;

    const text = currentResults.map(function (game, index) {
        return gameLabel(index) + ": " +
            game.numbers.join(", ") + " + 보너스 " + game.bonus;
    }).join("\n");

    navigator.clipboard.writeText(text)
        .then(function () { showToast("번호를 복사했어요"); })
        .catch(function () { showToast("복사에 실패했어요"); });
}

let toastTimer;
function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 1800);
}

function reset() {
    if (isDrawing) return;

    count = 0;
    history = [];
    currentResults = [];
    frequency.fill(0);
    countDisplay.textContent = "뽑은 기록 · 0회";
    resultsBox.innerHTML = '<div class="placeholder">버튼을 눌러 행운의 번호를 뽑아보세요!</div>';
    copyButton.disabled = true;
    renderHistory();
    renderStats(null);
    renderGrid();
}

/* ========== 이벤트 연결 ========== */

themeSelect.addEventListener("click", function (event) {
    const target = event.target.closest("button");
    if (!target) return;
    theme = target.dataset.value;
    saveSetting("lotto-theme", theme);
    applyTheme();
});

layoutSelect.addEventListener("click", function (event) {
    const target = event.target.closest("button");
    if (!target) return;
    layout = target.dataset.value;
    saveSetting("lotto-layout", layout);
    applyLayout();
});

gameSelect.addEventListener("click", function (event) {
    const target = event.target.closest("button");
    if (!target) return;
    games = Number(target.dataset.value);
    markActive(gameSelect, target.dataset.value);
});

numberGrid.addEventListener("click", function (event) {
    const cell = event.target.closest(".cell");
    if (!cell || isDrawing) return;
    toggleNumber(Number(cell.dataset.number));
});

clearPickButton.addEventListener("click", function () {
    fixedNumbers.clear();
    excludedNumbers.clear();
    renderGrid();
});

drawButton.addEventListener("click", draw);
copyButton.addEventListener("click", copyResults);
resetButton.addEventListener("click", reset);

// 스페이스바로 뽑기 (버튼에 포커스가 있을 때는 버튼 기본 동작에 맡김)
document.addEventListener("keydown", function (event) {
    if (event.code !== "Space") return;
    if (event.target.tagName === "BUTTON") return;

    event.preventDefault();
    draw();
});

/* ========== 시작 ========== */

applyTheme();
applyLayout();
renderGrid();
