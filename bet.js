const express = require("express");
const cors = require("cors");
const http = require("http");
const https = require("https");

const app = express();
app.use(cors());
app.use(express.json());

// =========================================================================
// 1. CẤU HÌNH HỆ THỐNG VÀ BỘ NHỚ ĐỆM ĐỒNG BỘ REALTIME
// =========================================================================
const PORT = process.env.PORT || 3000;
const URL_TAIXIU = "https://wtx.macminim6.online/v1/tx/sessions";
const URL_MD5 = "https://wtxmd52.macminim6.online/v1/txmd5/sessions";
const USER_ID = "@phong296 VIPPRO";

const STABILITY_WEIGHTS = {
    pattern_matching: 0.35,
    markov: 0.35,
    bet: 0.00,
    ping_pong: 0.00,
    cau_hinh_hoc: 0.20,
    overall_stats: 0.10
};

let cacheHistoryTaiXiu = [];
let cacheHistoryMD5 = [];

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

// =========================================================================
// 2. HỆ THỐNG THUẬT TOÁN DỰ ĐOÁN - CHỈ GIỮ CÁC CẦU: 1-1, 2-1-1-2, 2-1-2, 3-1, BỆT
// =========================================================================
function getPatternMatchingVote(history) {
    if (history.length < 30) return { vote: null, name: "PATTERN", score: 0 };

    let scores = { TAI: 0, XIU: 0 };
    const maxLen = Math.min(12, history.length - 5);
    
    for (let len = maxLen; len >= 3; len--) {
        const pattern = history.slice(-len).join(',');
        let matchCount = 0;
        let taiCount = 0;
        let xiuCount = 0;

        for (let i = 0; i < history.length - len - 1; i++) {
            if (history.slice(i, i + len).join(',') === pattern) {
                matchCount++;
                const next = history[i + len];
                if (next === "TAI") taiCount++;
                else xiuCount++;
            }
        }

        if (matchCount >= 2) {
            const weight = len / maxLen;
            if (taiCount > xiuCount) scores.TAI += weight * taiCount;
            else if (xiuCount > taiCount) scores.XIU += weight * xiuCount;
        }
    }

    if (scores.TAI === 0 && scores.XIU === 0) return { vote: null, name: "PATTERN", score: 0 };
    
    const total = scores.TAI + scores.XIU;
    const maxScore = Math.max(scores.TAI, scores.XIU);
    const confidence = Math.round((maxScore / total) * 100);
    
    return {
        vote: scores.TAI > scores.XIU ? "TAI" : "XIU",
        name: "PATTERN",
        score: confidence
    };
}

function getMarkovVote(history) {
    if (history.length < 60) return { vote: null, name: "MARKOV", score: 0 };

    let bestScore = 0;
    let bestVote = null;
    let bestName = "MARKOV";

    for (let order = 4; order >= 3; order--) {
        const state = history.slice(-order).join(',');
        let t = 0, x = 0;
        let occurrences = 0;

        for (let i = 0; i < history.length - order - 1; i++) {
            if (history.slice(i, i + order).join(',') === state) {
                occurrences++;
                if (history[i + order] === "TAI") t++;
                else x++;
            }
        }

        if (occurrences >= 2) {
            const score = Math.max(t, x);
            const total = t + x;
            const confidence = Math.round((score / total) * 100);
            
            if (confidence > bestScore) {
                bestScore = confidence;
                bestVote = t > x ? "TAI" : "XIU";
                bestName = `MARKOV-${order}`;
            }
        }
    }

    return {
        vote: bestVote,
        name: bestName,
        score: bestScore
    };
}

function getGeometricVote(history) {
    if (history.length < 8) return { vote: null, name: "HÌNH HỌC", score: 0 };

    const last3 = history.slice(-3).join(',');
    const last4 = history.slice(-4).join(',');
    const last5 = history.slice(-5).join(',');
    const last6 = history.slice(-6).join(',');
    const last7 = history.slice(-7).join(',');
    const last8 = history.slice(-8).join(',');

    // ===== CẦU 1-1 (XEN KẼ) =====
    if (last4 === "TAI,XIU,TAI,XIU") return { vote: "TAI", name: "1-1", score: 85 };
    if (last4 === "XIU,TAI,XIU,TAI") return { vote: "XIU", name: "1-1", score: 85 };
    if (last6 === "TAI,XIU,TAI,XIU,TAI,XIU") return { vote: "TAI", name: "1-1", score: 88 };
    if (last6 === "XIU,TAI,XIU,TAI,XIU,TAI") return { vote: "XIU", name: "1-1", score: 88 };
    if (last8 === "TAI,XIU,TAI,XIU,TAI,XIU,TAI,XIU") return { vote: "TAI", name: "1-1", score: 90 };
    if (last8 === "XIU,TAI,XIU,TAI,XIU,TAI,XIU,TAI") return { vote: "XIU", name: "1-1", score: 90 };

    // ===== CẦU 2-1-1-2 =====
    if (last6 === "TAI,TAI,XIU,TAI,TAI,XIU") return { vote: "TAI", name: "2-1-1-2", score: 86 };
    if (last6 === "XIU,XIU,TAI,XIU,XIU,TAI") return { vote: "XIU", name: "2-1-1-2", score: 86 };
    if (last6 === "TAI,TAI,XIU,XIU,TAI,TAI") return { vote: "XIU", name: "2-1-1-2", score: 84 };
    if (last6 === "XIU,XIU,TAI,TAI,XIU,XIU") return { vote: "TAI", name: "2-1-1-2", score: 84 };

    // ===== CẦU 2-1-2 =====
    if (last5 === "TAI,TAI,XIU,TAI,TAI") return { vote: "XIU", name: "2-1-2", score: 88 };
    if (last5 === "XIU,XIU,TAI,XIU,XIU") return { vote: "TAI", name: "2-1-2", score: 88 };
    if (last7 === "TAI,TAI,XIU,TAI,TAI,XIU,TAI") return { vote: "TAI", name: "2-1-2", score: 90 };
    if (last7 === "XIU,XIU,TAI,XIU,XIU,TAI,XIU") return { vote: "XIU", name: "2-1-2", score: 90 };

    // ===== CẦU 3-1 =====
    if (last4 === "TAI,TAI,TAI,XIU") return { vote: "TAI", name: "3-1", score: 82 };
    if (last4 === "XIU,XIU,XIU,TAI") return { vote: "XIU", name: "3-1", score: 82 };
    if (last5 === "TAI,TAI,TAI,XIU,XIU") return { vote: "TAI", name: "3-1", score: 80 };
    if (last5 === "XIU,XIU,XIU,TAI,TAI") return { vote: "XIU", name: "3-1", score: 80 };

    // ===== CẦU BỆT (CHUỖI LIÊN TIẾP) =====
    if (last3 === "TAI,TAI,TAI") return { vote: "TAI", name: "BỆT", score: 80 };
    if (last3 === "XIU,XIU,XIU") return { vote: "XIU", name: "BỆT", score: 80 };
    if (last4 === "TAI,TAI,TAI,TAI") return { vote: "TAI", name: "BỆT", score: 85 };
    if (last4 === "XIU,XIU,XIU,XIU") return { vote: "XIU", name: "BỆT", score: 85 };
    if (last5 === "TAI,TAI,TAI,TAI,TAI") return { vote: "TAI", name: "BỆT", score: 88 };
    if (last5 === "XIU,XIU,XIU,XIU,XIU") return { vote: "XIU", name: "BỆT", score: 88 };

    return { vote: null, name: "HÌNH HỌC", score: 0 };
}

function getStatsVote(history) {
    if (history.length < 20) return { vote: null, name: "STATS", score: 0 };
    
    const total = history.length;
    const taiCount = history.filter(x => x === "TAI").length;
    const xiuCount = total - taiCount;
    const taiRatio = taiCount / total;
    const xiuRatio = xiuCount / total;
    
    if (Math.abs(taiRatio - xiuRatio) < 0.15) return { vote: null, name: "STATS", score: 0 };
    
    const confidence = Math.round(Math.abs(taiRatio - xiuRatio) * 100) + 50;
    return {
        vote: taiRatio > xiuRatio ? "TAI" : "XIU",
        name: "STATS",
        score: Math.min(confidence, 90)
    };
}

// =========================================================================
// 3. CORE LOGIC DỰ ĐOÁN
// =========================================================================
async function checkAndPredictLive(apiUrl, storageCache) {
    try {
        const rawData = await fetchJson(apiUrl);
        const sessions = rawData.list || [];
        if (!sessions || sessions.length === 0) return;

        const latestFinishedSession = sessions[0];
        const lastFinishedId = Number(latestFinishedSession.id);

        for (let item of storageCache) {
            if (item.phien_hien_tai === lastFinishedId && item.trang_thai === "PENDING") {
                const realKq = latestFinishedSession.resultTruyenThong === "TAI" ? "Tài" : "Xỉu";
                item.phien = lastFinishedId;
                item.tong = latestFinishedSession.point;
                item.xuc_xac = latestFinishedSession.dices || [];
                item.ket_qua = realKq;
                item.trang_thai = (item.du_doan === realKq) ? "THẮNG" : "THUA";
            }
        }

        const nextPredictId = lastFinishedId + 1;
        if (storageCache.some(item => item.phien_hien_tai === nextPredictId)) return;

        const historyChain = sessions.map(s => s.resultTruyenThong).reverse();

        const pMatch = getPatternMatchingVote(historyChain);
        const markov = getMarkovVote(historyChain);
        const geo = getGeometricVote(historyChain);
        const stats = getStatsVote(historyChain);

        let votes = { "TAI": 0, "XIU": 0 };
        let totalWeight = 0;
        let matchedPattern = null;
        let maxScore = 0;

        if (pMatch.vote) {
            const weight = STABILITY_WEIGHTS.pattern_matching * (pMatch.score / 100);
            votes[pMatch.vote] += weight;
            totalWeight += weight;
            if (pMatch.score > maxScore) {
                maxScore = pMatch.score;
                matchedPattern = pMatch.name;
            }
        }

        if (markov.vote) {
            const weight = STABILITY_WEIGHTS.markov * (markov.score / 100);
            votes[markov.vote] += weight;
            totalWeight += weight;
            if (markov.score > maxScore) {
                maxScore = markov.score;
                matchedPattern = markov.name;
            }
        }

        if (geo.vote) {
            const weight = STABILITY_WEIGHTS.cau_hinh_hoc * (geo.score / 100);
            votes[geo.vote] += weight;
            totalWeight += weight;
            if (geo.score > maxScore) {
                maxScore = geo.score;
                matchedPattern = geo.name;
            }
        }

        if (stats.vote) {
            const weight = STABILITY_WEIGHTS.overall_stats * (stats.score / 100);
            votes[stats.vote] += weight;
            totalWeight += weight;
            if (stats.score > maxScore) {
                maxScore = stats.score;
                matchedPattern = stats.name;
            }
        }

        if (totalWeight === 0 || !matchedPattern) return;

        let finalPred = votes["TAI"] > votes["XIU"] ? "TAI" : "XIU";
        let confidence = Math.round((Math.max(votes["TAI"], votes["XIU"]) / totalWeight) * 100);
        confidence = Math.min(Math.max(confidence, 65), 92);

        const finalPredVn = finalPred === "TAI" ? "Tài" : "Xỉu";

        const newLiveRecord = {
            phien: "Chờ...",
            phien_hien_tai: nextPredictId,
            tong: "Chờ...",
            ket_qua: "Chờ...",
            xuc_xac: [],
            du_doan: finalPredVn,
            do_tin_cay: `${confidence}%`,
            cau: matchedPattern,
            trang_thai: "PENDING",
            id: USER_ID
        };

        storageCache.unshift(newLiveRecord);
        if (storageCache.length > 100) storageCache.pop();

    } catch (e) {
        console.error("Lỗi quét cổng ngầm API:", e.message);
    }
}

setInterval(() => {
    checkAndPredictLive(URL_TAIXIU, cacheHistoryTaiXiu);
    checkAndPredictLive(URL_MD5, cacheHistoryMD5);
}, 2000);

// =========================================================================
// 4. GIAO DIỆN CSS
// =========================================================================
const SHARED_STYLE = `
    body { background-color: #060913; color: #cbd5e1; font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px; }
    .header-wrapper {
        background: radial-gradient(circle at top, #111a2e 0%, #0a0f1d 100%);
        border: 1px solid #1e2e4d; border-radius: 16px; padding: 20px;
        box-shadow: 0 4px 30px rgba(0, 0, 0, 0.4); position: relative; overflow: hidden;
    }
    .header-wrapper::after {
        content: ''; position: absolute; bottom: 0; left: 0; width: 100%; height: 2px;
        background: linear-gradient(90deg, transparent, #eab308, #ef4444, #38bdf8, transparent);
    }
    .vipro-title {
        font-size: 22px; font-weight: 900; letter-spacing: 2px;
        background: linear-gradient(135deg, #ffffff 10%, #facc15 50%, #eab308 100%);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        text-shadow: 0 0 20px rgba(234,179,8,0.25);
    }
    .neon-box { border: 2px solid #1e293b; border-radius: 16px; padding: 15px; box-shadow: 0 0 25px rgba(56,189,248,0.06); height: 100%; }
    .neon-md5 { background: linear-gradient(145deg, #0f1c2e, #09101b); border-color: #f59e0b; }
    .neon-tx { background: linear-gradient(145deg, #1e1b29, #0d0b12); border-color: #ef4444; }
    .table { color: #e2e8f0; vertical-align: middle; text-align: center; border-color: #1e293b; width: 100% !important; }
    .table th { background-color: #020617; color: #94a3b8; font-weight: 700; text-transform: uppercase; font-size: 11px; padding: 10px; border-bottom: 2px solid #1e293b; }
    .table td { padding: 8px; border-bottom: 1px solid #1e293b; white-space: nowrap; }
    .txt-tai { color: #38bdf8 !important; font-weight: bold; }
    .txt-xiu { color: #ef4444 !important; font-weight: bold; }
    .txt-pct { color: #60a5fa; font-weight: 600; }
    .phien-id { color: #64748b; font-weight: 500; }
    .status-win { background-color: rgba(16,185,129,0.18); color: #10b981; border: 1px solid rgba(16,185,129,0.4); padding: 4px 14px; border-radius: 20px; font-weight: 900; font-size: 11px; display: inline-block; }
    .status-lose { background-color: rgba(239,68,68,0.14); color: #f87171; border: 1px solid rgba(239,68,68,0.35); padding: 4px 14px; border-radius: 20px; font-weight: 900; font-size: 11px; display: inline-block; }
    .status-pending { background-color: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3); padding: 4px 14px; border-radius: 20px; font-weight: 900; font-size: 11px; display: inline-block; }
    .badge-cau { background-color: #0f172a; color: #a5b4fc; border: 1px solid #312e81; font-size: 11px; padding: 2px 6px; font-weight: 600; text-transform: uppercase; }
    .new-row-anim { animation: flashRow 0.6s ease; }
    @keyframes flashRow { 0% { background-color: rgba(234,179,8,0.25); } 100% { background-color: transparent; } }
`;

// =========================================================================
// 5. HTTP SERVER
// =========================================================================
const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
    }

    const getCleanPrediction = (cacheList) => {
        const pendingItem = cacheList.find(item => item.trang_thai === "PENDING");
        if (!pendingItem) return {};
        return {
            phien_hien_tai: pendingItem.phien_hien_tai,
            du_doan: pendingItem.du_doan,
            do_tin_cay: pendingItem.do_tin_cay,
            cau_khop: pendingItem.cau,
            id: pendingItem.id
        };
    };

    if (req.url === "/taixiu") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify(getCleanPrediction(cacheHistoryTaiXiu)));
    }

    if (req.url === "/taixiumd5") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify(getCleanPrediction(cacheHistoryMD5)));
    }

    if (req.url === "/get-live-data") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({
            taixiu: cacheHistoryTaiXiu,
            md5: cacheHistoryMD5
        }));
    }

    if (req.url === "/lichsutx") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>Sảnh Thường VIPPRO</title>
<link href="https://jsdelivr.net" rel="stylesheet">
<style>${SHARED_STYLE}</style>
</head>
<body>
<div class="container py-4">
<div class="header-wrapper text-center mb-4">
<h3 class="vipro-title text-uppercase m-0">🔴 SẢNH TÀI XỈU TRUYỀN THỐNG</h3>
<p class="text-muted mt-2 mb-0">Nhà phát triển: ${USER_ID}</p>
</div>
<div class="row justify-content-center">
<div class="col-sm-12 col-md-10 col-xl-8">
<div class="neon-box neon-tx">
<div class="table-responsive" style="max-height:750px;">
<table class="table table-sm">
<thead class="sticky-top">
<tr>
<th>Mã Phiên</th><th>Xúc Xắc</th><th>Tổng</th><th>Kết Quả</th>
<th>Dự Đoán</th><th>Độ Tin</th><th>Cầu Khớp</th><th>Trạng Thái</th>
</tr>
</thead>
<tbody id="table-body"></tbody>
</table>
</div>
</div>
</div>
</div>
</div>
<script>
let oldFirstId = null;
function renderTable(dataList) {
    const tbody = document.getElementById('table-body');
    if (!dataList || !dataList.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-muted py-4 text-center">Đang chờ cổng API gốc nhảy phiên mới khớp mẫu cầu cược...</td></tr>';
        return;
    }
    const currentFirstId = dataList[0]?.phien_hien_tai;
    let hasNewRow = oldFirstId && currentFirstId !== oldFirstId;
    oldFirstId = currentFirstId;

    tbody.innerHTML = dataList.map((row, index) => {
        const isPending = row.trang_thai === "PENDING";
        const displayId = isPending ? '#' + row.phien_hien_tai + ' (Cược)' : '#' + row.phien;
        const displayDice = isPending ? 'Chờ...' : row.xuc_xac.join('·');
        const displayTong = row.tong;
        const clsKq = row.ket_qua === "Tài" ? "txt-tai" : (row.ket_qua === "Xỉu" ? "txt-xiu" : "text-muted");
        const clsDd = row.du_doan === "Tài" ? "txt-tai" : "txt-xiu";
        let clsStatus = "status-pending", symbolStatus = "CHỜ KQ";
        if (row.trang_thai === "THẮNG") { clsStatus = "status-win"; symbolStatus = "THẮNG"; }
        if (row.trang_thai === "THUA") { clsStatus = "status-lose"; symbolStatus = "THUA"; }
        const animClass = (index === 0 && hasNewRow) ? "class='new-row-anim'" : "";
        return '<tr ' + animClass + '>' +
            '<td class="phien-id">' + displayId + '</td>' +
            '<td class="text-muted">' + displayDice + '</td>' +
            '<td class="fw-bold text-white">' + displayTong + '</td>' +
            '<td class="' + clsKq + '">' + row.ket_qua.toUpperCase() + '</td>' +
            '<td class="' + clsDd + '">' + row.du_doan.toUpperCase() + '</td>' +
            '<td class="txt-pct">' + row.do_tin_cay + '</td>' +
            '<td><span class="badge badge-cau">' + row.cau + '</span></td>' +
            '<td><span class="' + clsStatus + '">' + symbolStatus + '</span></td>' +
        '</tr>';
    }).join('');
}
async function fetchUpdateLive() {
    try {
        const res = await fetch('/get-live-data');
        if (res.ok) {
            const data = await res.json();
            renderTable(data.taixiu);
        }
    } catch (e) { console.error("Lỗi đồng bộ:", e); }
}
fetchUpdateLive(); setInterval(fetchUpdateLive, 1500);
</script>
</body>
</html>`);
    }

    if (req.url === "/lichsumd5") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>Sảnh MD5 VIPPRO</title>
<link href="https://jsdelivr.net" rel="stylesheet">
<style>${SHARED_STYLE}</style>
</head>
<body>
<div class="container py-4">
<div class="header-wrapper text-center mb-4">
<h3 class="vipro-title text-uppercase m-0">⚡ SẢNH TÀI XỈU MD5 PREMIUM</h3>
<p class="text-muted mt-2 mb-0">Nhà phát triển: ${USER_ID}</p>
</div>
<div class="row justify-content-center">
<div class="col-sm-12 col-md-10 col-xl-8">
<div class="neon-box neon-md5">
<div class="table-responsive" style="max-height:750px;">
<table class="table table-sm">
<thead class="sticky-top">
<tr>
<th>Mã Phiên</th><th>Xúc Xắc</th><th>Tổng</th><th>Kết Quả</th>
<th>Dự Đoán</th><th>Độ Tin</th><th>Cầu Khớp</th><th>Trạng Thái</th>
</tr>
</thead>
<tbody id="table-body"></tbody>
</table>
</div>
</div>
</div>
</div>
</div>
<script>
let oldFirstId = null;
function renderTable(dataList) {
    const tbody = document.getElementById('table-body');
    if (!dataList || !dataList.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-muted py-4 text-center">Đang chờ cổng API gốc nhảy phiên mới khớp mẫu cầu cược...</td></tr>';
        return;
    }
    const currentFirstId = dataList[0]?.phien_hien_tai;
    let hasNewRow = oldFirstId && currentFirstId !== oldFirstId;
    oldFirstId = currentFirstId;

    tbody.innerHTML = dataList.map((row, index) => {
        const isPending = row.trang_thai === "PENDING";
        const displayId = isPending ? '#' + row.phien_hien_tai + ' (Cược)' : '#' + row.phien;
        const displayDice = isPending ? 'Chờ...' : row.xuc_xac.join('·');
        const displayTong = row.tong;
        const clsKq = row.ket_qua === "Tài" ? "txt-tai" : (row.ket_qua === "Xỉu" ? "txt-xiu" : "text-muted");
        const clsDd = row.du_doan === "Tài" ? "txt-tai" : "txt-xiu";
        let clsStatus = "status-pending", symbolStatus = "CHỜ KQ";
        if (row.trang_thai === "THẮNG") { clsStatus = "status-win"; symbolStatus = "THẮNG"; }
        if (row.trang_thai === "THUA") { clsStatus = "status-lose"; symbolStatus = "THUA"; }
        const animClass = (index === 0 && hasNewRow) ? "class='new-row-anim'" : "";
        return '<tr ' + animClass + '>' +
            '<td class="phien-id">' + displayId + '</td>' +
            '<td class="text-muted">' + displayDice + '</td>' +
            '<td class="fw-bold text-white">' + displayTong + '</td>' +
            '<td class="' + clsKq + '">' + row.ket_qua.toUpperCase() + '</td>' +
            '<td class="' + clsDd + '">' + row.du_doan.toUpperCase() + '</td>' +
            '<td class="txt-pct">' + row.do_tin_cay + '</td>' +
            '<td><span class="badge badge-cau">' + row.cau + '</span></td>' +
            '<td><span class="' + clsStatus + '">' + symbolStatus + '</span></td>' +
        '</tr>';
    }).join('');
}
async function fetchUpdateLive() {
    try {
        const res = await fetch('/get-live-data');
        if (res.ok) {
            const data = await res.json();
            renderTable(data.md5);
        }
    } catch (e) { console.error("Lỗi đồng bộ:", e); }
}
fetchUpdateLive(); setInterval(fetchUpdateLive, 1500);
</script>
</body>
</html>`);
    }

    if (req.url === "/" || req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Cổng kết nối không tồn tại.");
});

server.listen(PORT, () => {
    console.log("===============================================");
    console.log(`🚀 Server chạy tại PORT ${PORT}`);
    console.log(`👉 API TX     : http://localhost:${PORT}/taixiu`);
    console.log(`👉 API MD5    : http://localhost:${PORT}/taixiumd5`);
    console.log(`👉 Lịch sử TX : http://localhost:${PORT}/lichsutx`);
    console.log(`👉 Lịch sử MD5: http://localhost:${PORT}/lichsumd5`);
    console.log("===============================================");
});
