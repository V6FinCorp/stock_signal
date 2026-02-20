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
        ema: { enabled: true, fast_period: 9, slow_period: 20 },
        vol: { enabled: true, period: 20, threshold: 2.0 },
        dma: { enabled: true, periods: [20, 50, 200] }
    },
    intraday: {
        rsi: { enabled: true, period: 14, ob: 80, os: 20 },
        st: { enabled: true, period: 10, mult: 2.5 },
        ema: { enabled: true, fast_period: 9, slow_period: 21 },
        vol: { enabled: true, period: 20, threshold: 1.5 },
        dma: { enabled: false, periods: [10, 20] }
    }
};

let currentMode = 'swing';
let currentTimeframe = 'Daily';
let liveSignals = [];
let signalCache = {};
let activeStatFilter = 'all';

// --- Core API Logic ---

async function fetchAndRenderSignals(forceFetch = false) {
    const apiTf = TF_MAP[currentTimeframe] || '1d';
    const cacheKey = `${currentMode}_${apiTf}`;

    // Return instant cached data if we already requested this tab
    if (!forceFetch && signalCache[cacheKey]) {
        liveSignals = signalCache[cacheKey];
        renderSignals();
        return;
    }

    const tbody = document.getElementById('signal-tbody');
    tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 40px; color: var(--text-dim);"><i class="fas fa-circle-notch fa-spin fa-2x"></i><br><br>Loading live signals from App DB...</td></tr>';

    try {
        const response = await fetch(`/api/signals?mode=${currentMode}&timeframe=${apiTf}`);
        const result = await response.json();

        if (result.status === 'success') {
            liveSignals = result.data;
            signalCache[cacheKey] = liveSignals; // Save to memory cache
        } else {
            console.error(result.message);
            liveSignals = [];
        }
    } catch (e) {
        console.error("Fetch failed. Is your server running?", e);
        liveSignals = [];
    }

    renderSignals();
}

// --- UI Logic ---

function setStatFilter(filterType) {
    activeStatFilter = filterType;
    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active-filter'));
    document.getElementById(`card-${filterType}`).classList.add('active-filter');
    renderSignals();
}

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

    if (conf.ema.enabled) html += `<th>EMA (${conf.ema.fast_period}/${conf.ema.slow_period})</th>`;
    if (conf.vol && conf.vol.enabled) html += `<th>Volume (${conf.vol.threshold}x)</th>`;

    html += `<th>Strategy</th>`;

    if (conf.dma.enabled) {
        conf.dma.periods.forEach(p => {
            html += `<th>DMA ${p}</th>`;
        });
    }

    html += `
        <th>Supertrend</th>
        <th>MTF</th>
        <th>Trade Plan</th>
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

    // 1. Update Stats dynamically based on the full DB pull BEFORE filtering
    document.getElementById('stat-total').innerText = liveSignals.length.toLocaleString();
    const bullish = liveSignals.filter(s => s.supertrend_dir === 'BUY').length;
    document.getElementById('stat-bullish').innerText = bullish.toLocaleString();
    const bearish = liveSignals.filter(s => s.supertrend_dir === 'SELL').length;
    document.getElementById('stat-bearish').innerText = bearish.toLocaleString();
    const confluence = liveSignals.filter(s => s.confluence_rank >= 3).length;
    document.getElementById('stat-confluence').innerText = confluence.toLocaleString();

    // 2. Filter Data
    let displayData = liveSignals;

    // Filter by active stat card
    if (activeStatFilter === 'bullish') {
        displayData = displayData.filter(s => s.supertrend_dir === 'BUY');
    } else if (activeStatFilter === 'bearish') {
        displayData = displayData.filter(s => s.supertrend_dir === 'SELL');
    } else if (activeStatFilter === 'confluence') {
        displayData = displayData.filter(s => s.confluence_rank >= 3);
    }

    // Filter by rank dropdown
    const filterRank = document.getElementById('filter-rank') ? document.getElementById('filter-rank').value : 'all';
    if (filterRank !== 'all') {
        const minRank = parseInt(filterRank);
        displayData = displayData.filter(s => s.confluence_rank >= minRank);
    }

    // Filter by Search Input
    const searchQuery = document.getElementById('search-input') ? document.getElementById('search-input').value.trim().toUpperCase() : '';
    if (searchQuery) {
        displayData = displayData.filter(s =>
            s.symbol.toUpperCase().includes(searchQuery) ||
            s.isin.toUpperCase().includes(searchQuery)
        );
    }

    if (displayData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 40px; color: var(--text-dim);">No signals match your selected filters.</td></tr>`;
        return;
    }

    displayData.forEach(stock => {
        const score = stock.confluence_rank || 0;
        const row = document.createElement('tr');

        let rowHtml = `
            <td><div class="rank-badge ${score >= 3 ? 'rank-high' : ''}" style="margin-top: 2px;">${score}</div></td>
            <td>
                <div class="symbol-name">${stock.symbol}</div>
                <div class="isin-code">${stock.isin}</div>
            </td>
            <td><div style="font-weight: 700; font-size: 15px;">₹${(stock.ltp).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div></td>
        `;

        // RSI
        if (conf.rsi.enabled) {
            const rsi = stock.rsi;
            if (rsi !== null && rsi !== undefined) {
                rowHtml += `<td><div class="${rsi > conf.rsi.ob ? 'text-success' : (rsi < conf.rsi.os ? 'text-danger' : '')}" style="font-weight: 600; font-size: 15px;">${rsi.toFixed(1)}</div></td>`;
            } else {
                rowHtml += `<td><div style="font-size: 15px; color: var(--text-dim);">-</div></td>`;
            }
        }

        // EMA dynamic col
        if (conf.ema.enabled) {
            const sig = stock.ema_signal;
            const fast = stock.ema_fast;
            const slow = stock.ema_slow;
            if (sig) {
                rowHtml += `
                    <td>
                        <div class="${sig === 'BUY' ? 'text-success' : 'text-danger'} font-bold" style="font-size: 15px;">${sig}</div>
                        <div class="text-dim" style="font-size: 10px; margin-top: 2px;">(${fast ? fast.toFixed(1) : '-'}/${slow ? slow.toFixed(1) : '-'})</div>
                    </td>`;
            } else {
                rowHtml += `<td><div style="font-size: 15px; color: var(--text-dim);">-</div></td>`;
            }
        }

        // Volume Signal
        if (conf.vol && conf.vol.enabled) {
            const vSig = stock.volume_signal || 'NORMAL';
            const vRatio = stock.volume_ratio || 1.0;
            let vClass = '';
            if (vSig === 'BULL_SPIKE') vClass = 'text-success font-bold';
            else if (vSig === 'BEAR_SPIKE') vClass = 'text-danger font-bold';
            else vClass = 'text-dim font-bold';

            rowHtml += `
                <td>
                    <div class="${vClass}" style="font-size: 15px;">${vSig}</div>
                    <div class="text-dim" style="font-size: 10px; margin-top: 2px;">(${vRatio.toFixed(1)}x)</div>
                </td>`;
        }

        // Strategy Column
        const strat = stock.trade_strategy || 'NORMAL';
        let stratClass = 'bg-normal';
        let stratLabel = 'Neutral';
        if (strat === 'PERFECT_BUY') { stratClass = 'bg-perfect'; stratLabel = 'Perfect Setup'; }
        else if (strat === 'DMA_BOUNCE') { stratClass = 'bg-bounce'; stratLabel = 'Support Bounce'; }
        else if (strat === 'OVEREXTENDED') { stratClass = 'bg-stretch'; stratLabel = 'Stretched'; }

        rowHtml += `
            <td>
                <div class="strategy-badge ${stratClass}">${stratLabel}</div>
            </td>`;
        if (conf.dma.enabled) {
            conf.dma.periods.forEach(p => {
                const dmaVal = stock.dma_data ? stock.dma_data[`SMA_${p}`] : null;
                if (dmaVal !== null && dmaVal !== undefined) {
                    rowHtml += `<td><div class="${stock.ltp > dmaVal ? 'text-success' : 'text-danger'}" style="font-size: 14px; font-weight: 600;">${dmaVal.toFixed(1)}</div></td>`;
                } else {
                    rowHtml += `<td><div style="font-size: 14px; color: var(--text-dim);">-</div></td>`;
                }
            });
        }

        // Supetrend
        rowHtml += `
            <td>
                <div class="signal-pill ${stock.supertrend_dir === 'BUY' ? 'pill-buy' : (stock.supertrend_dir === 'SELL' ? 'pill-sell' : 'pill-wait')}" style="font-size: 13px;">${stock.supertrend_dir || '-'}</div>
                <div class="st-value" style="margin-top: 4px;">@ ${stock.supertrend_value !== null ? stock.supertrend_value.toFixed(2) : '-'}</div>
            </td>
            `;

        // MTF Agreement
        rowHtml += `<td class="tf-agreement" style="gap: 8px; justify-content: flex-start; align-items: center; display: flex; padding-top: 22px;">`;
        MODES[currentMode].timeframes.forEach(tf => {
            const apiTf = TF_MAP[tf];
            const dir = (stock.mtf_data && stock.mtf_data[apiTf]) ? stock.mtf_data[apiTf] : null;

            let dotClass = 'tf-dot';
            if (dir === 'BUY') {
                dotClass += ' dot-bull';
            } else if (dir === 'SELL') {
                dotClass += ' dot-bear';
            }

            rowHtml += `<div class="${dotClass}" title="${tf}: ${dir || 'Calculating...'}"></div>`;
        });
        rowHtml += `</td>`;

        // Trade Plan Column
        const ltp_val = stock.ltp;
        const slDiffPct = stock.sl ? ((stock.sl - ltp_val) / ltp_val * 100).toFixed(1) : null;
        const tgtDiffPct = stock.target ? ((stock.target - ltp_val) / ltp_val * 100).toFixed(1) : null;
        const slAbs = slDiffPct ? Math.abs(parseFloat(slDiffPct)).toFixed(1) : '0.0';
        const tgtAbs = tgtDiffPct ? Math.abs(parseFloat(tgtDiffPct)).toFixed(1) : '0.0';

        const isBuy = stock.supertrend_dir !== 'SELL';
        const actionLabel = isBuy ? 'B' : 'S';
        const actionColor = isBuy ? '#22c55e' : '#ef4444'; // Solid green / red
        const tgtPrefix = (parseFloat(tgtDiffPct) > 0) ? '+' : '';

        rowHtml += `
            <td>
                <div class="trade-plan-box" style="min-width: 170px;">
                    <div class="tp-row" style="justify-content: flex-start; gap: 8px;">
                        <span class="text-dim" style="width: 25px;">SL:</span>
                        <span class="text-danger font-bold">₹${stock.sl ? stock.sl.toFixed(1) : '-'}</span>
                        <span style="font-size: 11px; color: var(--danger); opacity: 0.8;">(${slDiffPct ? slDiffPct + '%' : '-'})</span>
                    </div>
                    <div class="tp-row" style="justify-content: flex-start; gap: 8px; margin-top: 2px;">
                        <span class="text-dim" style="width: 25px;">Tgt:</span>
                        <span class="text-success font-bold">₹${stock.target ? stock.target.toFixed(1) : '-'}</span>
                        <span style="font-size: 11px; color: var(--success); opacity: 0.8;">(${tgtDiffPct ? tgtPrefix + tgtDiffPct + '%' : '-'})</span>
                    </div>
                    <div class="tp-row" style="justify-content: flex-start; align-items: center; margin-top: 6px; border-top: 1px solid var(--border-color); padding-top: 8px;">
                        <span style="font-size: 11px; font-weight: 700; color: var(--amber); letter-spacing: 0.2px;">RR ${slAbs}:${tgtAbs}</span>
                        <span class="text-dim" style="margin: 0 12px; opacity: 0.4;">|</span>
                        <button class="btn" title="${isBuy ? 'Buy' : 'Short'} Trade" style="padding: 2px 14px; border-radius: 4px; font-size: 13px; font-weight: 900; background: ${actionColor}; color: white; border: none; cursor: pointer;">
                            ${actionLabel}
                        </button>
                    </div>
                </div>
            </td>
        `;
        row.innerHTML = rowHtml;
        tbody.appendChild(row);
    });
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
    document.getElementById('setting-ema-fast').value = conf.ema.fast_period;
    document.getElementById('setting-ema-slow').value = conf.ema.slow_period;

    if (conf.vol) {
        document.getElementById('setting-vol-enabled').checked = conf.vol.enabled;
        document.getElementById('setting-vol-period').value = conf.vol.period;
        document.getElementById('setting-vol-threshold').value = conf.vol.threshold;
    }

    document.getElementById('setting-dma-enabled').checked = conf.dma.enabled;
    [10, 20, 50, 100, 200].forEach(p => {
        const el = document.getElementById(`dma - ${p} `);
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
    conf.ema.fast_period = parseInt(document.getElementById('setting-ema-fast').value);
    conf.ema.slow_period = parseInt(document.getElementById('setting-ema-slow').value);

    if (conf.vol) {
        conf.vol.enabled = document.getElementById('setting-vol-enabled').checked;
        conf.vol.period = parseInt(document.getElementById('setting-vol-period').value);
        conf.vol.threshold = parseFloat(document.getElementById('setting-vol-threshold').value);
    }

    conf.dma.enabled = document.getElementById('setting-dma-enabled').checked;
    conf.dma.periods = [];
    [10, 20, 50, 100, 200].forEach(p => {
        const el = document.getElementById(`dma - ${p} `);
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

function toggleSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    const mainContent = document.querySelector('.main-content');
    sidebar.classList.toggle('collapsed');
    mainContent.classList.toggle('expanded');
}

async function refreshSignals() {
    const btnIcon = document.getElementById('refresh-icon');
    const container = document.getElementById('progress-container');
    const fill = document.getElementById('progress-fill');
    const percent = document.getElementById('progress-percent');

    container.classList.remove('hidden');
    btnIcon.classList.add('fa-spin');

    // Simulate progress while API loads
    let progress = 0;
    const interval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress >= 85) clearInterval(interval);
        fill.style.width = `${Math.min(progress, 85)}% `;
        percent.innerText = `${Math.floor(Math.min(progress, 85))}% `;
    }, 150);

    try {
        const apiTf = TF_MAP[currentTimeframe] || '1d';

        // 1. Manually trigger the Pandas-TA calculating backend
        await fetch(`/ api / calculate ? mode = ${currentMode}& timeframe=${apiTf} `, {
            method: 'POST'
        });

        // 2. Fetch the newly injected signals from DB & force cache overwrite
        await fetchAndRenderSignals(true);

    } catch (e) {
        console.error("Failed to trigger engine:", e);
    } finally {
        clearInterval(interval);
        fill.style.width = `100 % `;
        percent.innerText = `100 % `;
        setTimeout(() => {
            container.classList.add('hidden');
            btnIcon.classList.remove('fa-spin');
        }, 500);
    }
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
