const drawButton = document.getElementById("drawButton");
const copyButton = document.getElementById("copyButton");
const resetButton = document.getElementById("resetButton");
const gameSelect = document.getElementById("gameSelect");
const resultsBox = document.getElementById("results");
const countDisplay = document.getElementById("count");
const historyList = document.getElementById("historyList");
const toast = document.getElementById("toast");

const MAX_NUMBER = 45;
const PICK_COUNT = 6;
const MAX_HISTORY = 5; // 기록은 최근 5게임까지만 표시
const BALL_DELAY = 120; // 공이 하나씩 나오는 간격 (ms)

let games = 1;
let count = 0;
let history = [];
let currentResults = [];
let isDrawing = false;

// 1 ~ 45 중 겹치지 않게 n개 뽑기 (섞은 뒤 앞에서부터 자르기)
function pickNumbers(n) {
    const pool = [];
    for (let i = 1; i <= MAX_NUMBER; i++) pool.push(i);

    // 피셔-예이츠 셔플
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
}

// 한 게임 = 번호 6개(오름차순) + 보너스 1개
function drawGame() {
    const picked = pickNumbers(PICK_COUNT + 1);
    const bonus = picked.pop();
    const numbers = picked.sort(function (a, b) { return a - b; });
    return { numbers, bonus };
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
        label.textContent = String.fromCharCode(65 + index); // A, B, C...
        row.appendChild(label);

        const balls = document.createElement("div");
        balls.className = "balls";

        game.numbers.forEach(function (n) {
            const ball = createBall(n);
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
        countDisplay.textContent = "뽑은 횟수: " + count + "회";

        history = currentResults.concat(history).slice(0, MAX_HISTORY);
        renderHistory();

        copyButton.disabled = false;
        drawButton.disabled = false;
        isDrawing = false;
    }, delay + 200);
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
        historyList.appendChild(item);
    });
}

function copyResults() {
    if (currentResults.length === 0) return;

    const text = currentResults.map(function (game, index) {
        return String.fromCharCode(65 + index) + ": " +
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
    toastTimer = setTimeout(function () { toast.hidden = true; }, 1600);
}

function reset() {
    if (isDrawing) return;

    count = 0;
    history = [];
    currentResults = [];
    countDisplay.textContent = "뽑은 횟수: 0회";
    resultsBox.innerHTML = '<div class="placeholder">버튼을 눌러 행운의 번호를 뽑아보세요!</div>';
    copyButton.disabled = true;
    renderHistory();
}

// 게임 수 선택
gameSelect.addEventListener("click", function (event) {
    const target = event.target.closest("button");
    if (!target) return;

    games = Number(target.dataset.games);
    gameSelect.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("active", b === target);
    });
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
