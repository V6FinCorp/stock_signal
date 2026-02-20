// --- Application State ---
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
        defaultTF: "5m", // Adjusted API mapping default
        total: 200
    }
};

const TF_MAP = {
    "Daily": "1d",
    "Weekly": "1w", // Will fall back gracefully if not populated in DB
    "Monthly": "1mo",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "60m": "60m"
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
let liveSignals = [];

// --- Core API Logic ---

async function fetchAndRenderSignals() {
    const tbody = document.getElementById('signal-tbody');
    tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 40px; color: var(--text-dim);"><i class="fas fa-circle-notch fa-spin fa-2x"></i><br><br>Loading live signals from App DB...</td></tr>';

    // Map UI timeframe to API timeframe
    const apiTf = TF_MAP[currentTimeframe] || '1d';

    try {
        const response = await fetch(`http://127.0.0.1:8000/api/signals?mode=${currentMode}&timeframe=${apiTf}`);
        const result = await response.json();

        if (result.status === 'success') {
            liveSignals = result.data;
        } else {
            console.error(result.message);
            liveSignals = [];
        }
    } catch (e) {
        console.error("Fetch failed. Is your PHP server running?", e);
        liveSignals = [];
    }

    renderSignals();
}

// --- UI Logic ---

function setMode(mode) {
    currentMode = mode;
    currentTimeframe = MODES[mode].defaultTF;

    // UI Updates
    document.getElementById('mode-swing').classList.toggle('active', mode === 'swing');
    document.getElementById('mode-intraday').classList.toggle('active', mode === 'intraday');
    document.getElementById('page-title').innerText = MODES[mode].title;

    // Update settings selector to match mode context
    document.getElementById('config-profile-selector').value = mode;

    renderTimeframes();
    updateTableHeader();
    fetchAndRenderSignals();
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
            updateTableHeader();
            fetchAndRenderSignals();
        };
        container.appendChild(btn);
    });
}

function renderSignals() {
    const tbody = document.getElementById('signal-tbody');
    tbody.innerHTML = '';

    const conf = CONFIGS[currentMode];

    // Filter by rank if needed
    const filterRank = document.getElementById('filter-rank') ? document.getElementById('filter-rank').value : 'all';
    let displayData = liveSignals;

    if (filterRank !== 'all') {
        const minRank = parseInt(filterRank);
        displayData = displayData.filter(s => s.confluence_rank >= minRank);
    }

    if (displayData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 40px; color: var(--text-dim);">No signals found.<br>Ensure the Python Indicator Engine has processed this timeframe (' + TF_MAP[currentTimeframe] + ')</td></tr>';

        // Zero out stats
        document.getElementById('stat-total').innerText = '0';
        document.getElementById('stat-bullish').innerText = '0';
        document.getElementById('stat-bearish').innerText = '0';
        document.getElementById('stat-confluence').innerText = '0';
        return;
    }

    displayData.forEach(stock => {
        const score = stock.confluence_rank || 0;
        const row = document.createElement('tr');

        let rowHtml = `
            <td><div class="rank-badge ${score >= 3 ? 'rank-high' : ''}">${score}</div></td>
            <td>
                <span class="symbol-name">${stock.symbol}</span>
                <span class="isin-code">${stock.isin}</span>
            </td>
            <td><strong>₹${(stock.ltp).toFixed(2)}</strong></td>
        `;

        // RSI
        if (conf.rsi.enabled) {
            const rsi = stock.rsi;
            if (rsi !== null && rsi !== undefined) {
                rowHtml += `<td><span class="${rsi > conf.rsi.ob ? 'text-success' : (rsi < conf.rsi.os ? 'text-danger' : '')}">${rsi.toFixed(1)}</span></td>`;
            } else {
                rowHtml += `<td>-</td>`;
            }
        }

        // EMA dynamic col
        if (conf.ema.enabled) {
            const ema = stock.ema_value;
            if (ema !== null && ema !== undefined) {
                rowHtml += `<td><span class="${stock.ltp > ema ? 'text-success' : 'text-danger'}">${ema.toFixed(1)}</span></td>`;
            } else {
                rowHtml += `<td>-</td>`;
            }
        }

        // DMA dynamic cols
        if (conf.dma.enabled) {
            conf.dma.periods.forEach(p => {
                const dmaVal = stock.dma_data ? stock.dma_data[`SMA_${p}`] : null;
                if (dmaVal !== null && dmaVal !== undefined) {
                    rowHtml += `<td><span class="${stock.ltp > dmaVal ? 'text-success' : 'text-danger'}">${dmaVal.toFixed(1)}</span></td>`;
                } else {
                    rowHtml += `<td>-</td>`;
                }
            });
        }

        // Supetrend
        rowHtml += `
            <td>
                <span class="signal-pill ${stock.supertrend_dir === 'BUY' ? 'pill-buy' : (stock.supertrend_dir === 'SELL' ? 'pill-sell' : 'pill-wait')}">${stock.supertrend_dir || '-'}</span>
                <div class="st-value">@ ${stock.supertrend_value !== null ? stock.supertrend_value.toFixed(2) : '-'}</div>
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

    // Update Stats dynamically based on the DB pull
    document.getElementById('stat-total').innerText = liveSignals.length.toLocaleString();
    const bullish = liveSignals.filter(s => s.supertrend_dir === 'BUY').length;
    document.getElementById('stat-bullish').innerText = bullish.toLocaleString();
    const bearish = liveSignals.filter(s => s.supertrend_dir === 'SELL').length;
    document.getElementById('stat-bearish').innerText = bearish.toLocaleString();
    const confluence = liveSignals.filter(s => s.confluence_rank >= 3).length;
    document.getElementById('stat-confluence').innerText = confluence.toLocaleString();
}

// Global Filter Setup
document.getElementById('filter-rank').addEventListener('change', renderSignals);


// --- Settings Logic ---

function loadProfileSettings() {
    const profile = document.getElementById('config-profile-selector').value;
    const conf = CONFIGS[profile];

    document.getElementById('setting-rsi-enabled').checked = conf.rsi.enabled;
    document.getElementById('setting-rsi-period').value = conf.rsi.period;
    document.getElementById('setting-rsi-ob').value = conf.rsi.ob;
    document.getElementById('setting-rsi-os').value = conf.rsi.os;

    document.getElementById('setting-st-enabled').checked = conf.st.enabled;
    document.getElementById('setting-st-period').value = conf.st.period;
    document.getElementById('setting-st-mult').value = conf.st.mult;

    document.getElementById('setting-ema-enabled').checked = conf.ema.enabled;
    document.getElementById('setting-ema-period').value = conf.ema.period;

    document.getElementById('setting-dma-enabled').checked = conf.dma.enabled;
    [10, 20, 50, 100, 200].forEach(p => {
        const el = document.getElementById(`dma-${p}`);
        if (el) el.checked = conf.dma.periods.includes(p);
    });
}

function saveProfileSettings() {
    const profile = document.getElementById('config-profile-selector').value;
    const conf = CONFIGS[profile];

    conf.rsi.enabled = document.getElementById('setting-rsi-enabled').checked;
    conf.rsi.period = parseInt(document.getElementById('setting-rsi-period').value);
    conf.rsi.ob = parseInt(document.getElementById('setting-rsi-ob').value);
    conf.rsi.os = parseInt(document.getElementById('setting-rsi-os').value);

    conf.st.enabled = document.getElementById('setting-st-enabled').checked;
    conf.st.period = parseInt(document.getElementById('setting-st-period').value);
    conf.st.mult = parseFloat(document.getElementById('setting-st-mult').value);

    conf.ema.enabled = document.getElementById('setting-ema-enabled').checked;
    conf.ema.period = parseInt(document.getElementById('setting-ema-period').value);

    conf.dma.enabled = document.getElementById('setting-dma-enabled').checked;
    conf.dma.periods = [];
    [10, 20, 50, 100, 200].forEach(p => {
        const el = document.getElementById(`dma-${p}`);
        if (el && el.checked) conf.dma.periods.push(p);
    });

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

    // Simulate progress while API loads
    let progress = 0;
    const interval = setInterval(() => {
        progress += Math.random() * 20;
        if (progress >= 85) clearInterval(interval);
        fill.style.width = `${Math.min(progress, 85)}%`;
        percent.innerText = `${Math.floor(Math.min(progress, 85))}%`;
    }, 150);

    // Call API Route
    fetchAndRenderSignals().then(() => {
        clearInterval(interval);
        fill.style.width = `100%`;
        percent.innerText = `100%`;
        setTimeout(() => {
            container.classList.add('hidden');
            btnIcon.classList.remove('fa-spin');
        }, 500);
    });
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
