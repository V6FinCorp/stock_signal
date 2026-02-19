// --- Mock Data ---
const MOCK_STOCKS = [
    { symbol: "RELIANCE", isin: "INE002A01018", price: 2985.40, rsi: 62.5, ema20: 2940.0, st_signal: "BUY", st_value: 2890.15, scores: { "5m": 2, "15m": 3, "60m": 1, "D": 4 } },
    { symbol: "TCS", isin: "INE467B01029", price: 4120.25, rsi: 42.1, ema20: 4150.0, st_signal: "SELL", st_value: 4180.50, scores: { "5m": 0, "15m": 1, "60m": 2, "D": 1 } },
    { symbol: "HDFCBANK", isin: "INE040A01034", price: 1642.10, rsi: 68.9, ema20: 1610.0, st_signal: "BUY", st_value: 1595.00, scores: { "5m": 3, "15m": 4, "60m": 4, "D": 3 } },
    { symbol: "NHPC", isin: "INE848E01016", price: 76.34, rsi: 71.2, ema20: 74.5, st_signal: "BUY", st_value: 72.10, scores: { "5m": 4, "15m": 4, "60m": 3, "D": 2 } },
    { symbol: "INFY", isin: "INE009A01021", price: 1680.45, rsi: 55.4, ema20: 1670.0, st_signal: "BUY", st_value: 1650.20, scores: { "5m": 2, "15m": 2, "60m": 2, "D": 3 } },
    { symbol: "ICICIBANK", isin: "INE090A01021", price: 1105.30, rsi: 38.5, ema20: 1120.0, st_signal: "SELL", st_value: 1135.00, scores: { "5m": 1, "15m": 0, "60m": 1, "D": 1 } },
    { symbol: "ZOMATO", isin: "INE758T01015", price: 254.90, rsi: 78.2, ema20: 242.0, st_signal: "BUY", st_value: 235.40, scores: { "5m": 4, "15m": 4, "60m": 4, "D": 4 } },
    { symbol: "ADANIENT", isin: "INE423A01024", price: 3120.00, rsi: 45.0, ema20: 3145.0, st_signal: "SELL", st_value: 3200.00, scores: { "5m": 1, "15m": 1, "60m": 0, "D": 0 } }
];

const MODES = {
    swing: {
        title: "Swing Trading Dashboard",
        timeframes: ["Daily", "Weekly", "Monthly"],
        defaultTF: "Daily",
        total: 5000
    },
    intraday: {
        title: "Intraday Momentum",
        timeframes: ["5m", "15m", "30m", "60m"],
        defaultTF: "15m",
        total: 200
    }
};

const CONFIGS = {
    swing: {
        rsi: { enabled: true, period: 14, ob: 70, os: 30 },
        st: { enabled: true, period: 10, mult: 3.0 },
        ema: { enabled: true, period: 20 },
        dma: { enabled: true, periods: [20, 50, 200] }
    },
    intraday: {
        rsi: { enabled: true, period: 14, ob: 80, os: 20 },
        st: { enabled: true, period: 10, mult: 2.5 },
        ema: { enabled: true, period: 9 },
        dma: { enabled: false, periods: [10, 20] }
    }
};

let currentMode = 'swing';
let currentTimeframe = 'Daily';

// --- Core State Logic ---

function setMode(mode) {
    currentMode = mode;
    currentTimeframe = MODES[mode].defaultTF;

    // UI Updates
    document.getElementById('mode-swing').classList.toggle('active', mode === 'swing');
    document.getElementById('mode-intraday').classList.toggle('active', mode === 'intraday');
    document.getElementById('page-title').innerText = MODES[mode].title;
    document.getElementById('stat-total').innerText = MODES[mode].total.toLocaleString();

    // Update settings selector to match mode context
    document.getElementById('config-profile-selector').value = mode;

    renderTimeframes();
    updateTableHeader();
    renderSignals();
}

function updateTableHeader() {
    const thead = document.querySelector('.signal-table thead tr');
    const conf = CONFIGS[currentMode];

    let html = `
        <th>Rank</th>
        <th>Stock Detail</th>
        <th>LTP</th>
        <th>RSI</th>
    `;

    if (conf.ema.enabled) html += `<th>EMA (${conf.ema.period})</th>`;

    if (conf.dma.enabled) {
        conf.dma.periods.forEach(p => {
            html += `<th>DMA ${p}</th>`;
        });
    }

    html += `
        <th>Supertrend</th>
        <th>MTF</th>
        <th>Action</th>
    `;
    thead.innerHTML = html;
}

function renderTimeframes() {
    const container = document.getElementById('timeframe-container');
    container.innerHTML = '';

    MODES[currentMode].timeframes.forEach(tf => {
        const btn = document.createElement('button');
        btn.className = `tf-btn ${tf === currentTimeframe ? 'active' : ''}`;
        btn.innerText = tf;
        btn.onclick = () => {
            currentTimeframe = tf;
            renderTimeframes();
            renderSignals();
        };
        container.appendChild(btn);
    });
}

function renderSignals() {
    const tbody = document.getElementById('signal-tbody');
    tbody.innerHTML = '';

    const tfKey = currentTimeframe.includes('m') ? currentTimeframe : currentTimeframe[0];
    const sortedData = [...MOCK_STOCKS].sort((a, b) => (b.scores[tfKey] || 0) - (a.scores[tfKey] || 0));
    const conf = CONFIGS[currentMode];

    sortedData.forEach(stock => {
        const score = stock.scores[tfKey] || 0;
        const row = document.createElement('tr');

        let rowHtml = `
            <td><div class="rank-badge ${score >= 3 ? 'rank-high' : ''}">${score}</div></td>
            <td>
                <span class="symbol-name">${stock.symbol}</span>
                <span class="isin-code">${stock.isin}</span>
            </td>
            <td><strong>₹${stock.price.toFixed(2)}</strong></td>
            <td><span class="${stock.rsi > conf.rsi.ob ? 'text-success' : stock.rsi < conf.rsi.os ? 'text-danger' : ''}">${stock.rsi}</span></td>
        `;

        // EMA dynamic col
        if (conf.ema.enabled) {
            rowHtml += `<td><span class="${stock.price > stock.ema20 ? 'text-success' : 'text-danger'}">${stock.ema20.toFixed(1)}</span></td>`;
        }

        // DMA dynamic cols
        if (conf.dma.enabled) {
            conf.dma.periods.forEach(p => {
                // Mock value for DMA p
                const mockDmaVal = stock.ema20 * (1 - (p / 1000));
                rowHtml += `<td><span class="${stock.price > mockDmaVal ? 'text-success' : 'text-danger'}">${mockDmaVal.toFixed(1)}</span></td>`;
            });
        }

        rowHtml += `
            <td>
                <span class="signal-pill ${stock.st_signal === 'BUY' ? 'pill-buy' : 'pill-sell'}">${stock.st_signal}</span>
                <div class="st-value">@ ${stock.st_value.toFixed(2)}</div>
            </td>
            <td>
                <div class="tf-agreement">
                    ${renderDots(stock.scores)}
                </div>
            </td>
            <td>
                <button class="btn btn-dim" style="padding: 6px 12px; font-size: 11px;">
                    <i class="fas fa-chart-area"></i>
                </button>
            </td>
        `;
        row.innerHTML = rowHtml;
        tbody.appendChild(row);
    });
}

function renderDots(scores) {
    const tfs = ['5m', '15m', '60m', 'D'];
    return tfs.map(tf => {
        const s = scores[tf] || 0;
        const status = s > 2 ? 'dot-bull' : s < 2 ? 'dot-bear' : '';
        return `<div class="tf-dot ${status}" title="${tf}: Rank ${s}"></div>`;
    }).join('');
}

// --- Settings Logic ---

function loadProfileSettings() {
    const profile = document.getElementById('config-profile-selector').value;
    const conf = CONFIGS[profile];

    // Load RSI
    document.getElementById('setting-rsi-enabled').checked = conf.rsi.enabled;
    document.getElementById('setting-rsi-period').value = conf.rsi.period;
    document.getElementById('setting-rsi-ob').value = conf.rsi.ob;
    document.getElementById('setting-rsi-os').value = conf.rsi.os;

    // Load ST
    document.getElementById('setting-st-enabled').checked = conf.st.enabled;
    document.getElementById('setting-st-period').value = conf.st.period;
    document.getElementById('setting-st-mult').value = conf.st.mult;

    // Load EMA
    document.getElementById('setting-ema-enabled').checked = conf.ema.enabled;
    document.getElementById('setting-ema-period').value = conf.ema.period;

    // Load DMA
    document.getElementById('setting-dma-enabled').checked = conf.dma.enabled;
    [10, 20, 50, 200, 300].forEach(p => {
        const el = document.getElementById(`dma-${p}`);
        if (el) el.checked = conf.dma.periods.includes(p);
    });
}

function saveProfileSettings() {
    const profile = document.getElementById('config-profile-selector').value;
    const conf = CONFIGS[profile];

    // Read RSI
    conf.rsi.enabled = document.getElementById('setting-rsi-enabled').checked;
    conf.rsi.period = parseInt(document.getElementById('setting-rsi-period').value);
    conf.rsi.ob = parseInt(document.getElementById('setting-rsi-ob').value);
    conf.rsi.os = parseInt(document.getElementById('setting-rsi-os').value);

    // Read ST
    conf.st.enabled = document.getElementById('setting-st-enabled').checked;
    conf.st.period = parseInt(document.getElementById('setting-st-period').value);
    conf.st.mult = parseFloat(document.getElementById('setting-st-mult').value);

    // Read EMA
    conf.ema.enabled = document.getElementById('setting-ema-enabled').checked;
    conf.ema.period = parseInt(document.getElementById('setting-ema-period').value);

    // Read DMA
    conf.dma.enabled = document.getElementById('setting-dma-enabled').checked;
    conf.dma.periods = [];
    [10, 20, 50, 200, 300].forEach(p => {
        const el = document.getElementById(`dma-${p}`);
        if (el && el.checked) conf.dma.periods.push(p);
    });

    // Mirror to active mode if it's the one we just edited
    if (currentMode === profile) {
        updateTableHeader();
        renderSignals();
    }

    toggleSettings();
}

function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    const isHidden = modal.classList.toggle('hidden');
    if (!isHidden) {
        loadProfileSettings();
    }
}

function refreshSignals() {
    const btnIcon = document.getElementById('refresh-icon');
    const container = document.getElementById('progress-container');
    const fill = document.getElementById('progress-fill');
    const percent = document.getElementById('progress-percent');

    container.classList.remove('hidden');
    btnIcon.classList.add('fa-spin');

    let progress = 0;
    const interval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress >= 100) {
            progress = 100;
            clearInterval(interval);

            setTimeout(() => {
                container.classList.add('hidden');
                btnIcon.classList.remove('fa-spin');
                renderSignals();
            }, 500);
        }
        fill.style.width = `${progress}%`;
        percent.innerText = `${Math.floor(progress)}%`;
    }, 200);
}

// --- Initialize ---
window.onload = () => {
    setMode('swing');

    window.onclick = function (event) {
        const modal = document.getElementById('settings-modal');
        if (event.target == modal) {
            toggleSettings();
        }
    }
};
