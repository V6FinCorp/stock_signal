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
        dma: { enabled: true, periods: [10, 20, 50, 200] },
        patterns: { enabled: true, bullish: true, bearish: true, neutral: false },
        auto: { fetch: true, calc: true, interval: 1800000, marketHoursOnly: true },
        chart: { bars: 30, ema: true, st: true, dma: true, vol: true }
    },
    intraday: {
        rsi: { enabled: true, period: 14, ob: 80, os: 20 },
        st: { enabled: true, period: 10, mult: 2.5 },
        ema: { enabled: true, fast_period: 9, slow_period: 21 },
        vol: { enabled: true, period: 20, threshold: 1.5 },
        dma: { enabled: false, periods: [10, 20] },
        patterns: { enabled: true, bullish: true, bearish: true, neutral: false },
        auto: { fetch: true, calc: true, interval: 300000, marketHoursOnly: true },
        chart: { bars: 30, ema: true, st: true, dma: true, vol: true }
    }
};

let currentMode = 'swing';
let currentTimeframe = 'Daily';
let fetchEvtSource = null;
let liveSignals = [];
let signalCache = {};
let activeStatFilter = 'all';
let currentSortColumn = 'rsi'; // Default sort by RSI
let currentSortDirection = 'desc'; // Default desc

let autoSyncTimerId = null;
let isAutoSyncEnabled = false;

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
    tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 40px; color: var(--text-dim);"><i class="fas fa-circle-notch fa-spin fa-2x"></i><br><br>Analyzing latest market signals...</td></tr>';

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
    fetchSystemStatus();
}

async function fetchSystemStatus() {
    try {
        const response = await fetch(`/api/status?mode=${currentMode}&_=${Date.now()}`);
        const status = await response.json();

        let fetchTime = status[currentMode]?.last_fetch || 'Never';
        let calcTime = status[currentMode]?.last_calc || 'Never';
        let ohlcTime = status[currentMode]?.latest_ohlc || 'Never';

        document.getElementById('last-fetch-time').innerText = fetchTime;
        document.getElementById('last-calc-time').innerText = calcTime;
        document.getElementById('latest-ohlc-time').innerText = ohlcTime;
    } catch (e) {
        console.error("Failed to fetch system status:", e);
    }
}

function updateTableHeader() {
    const thead = document.querySelector('#main-signal-table thead tr');
    thead.innerHTML = '';
    const conf = CONFIGS[currentMode];

    const createHeader = (label, key, sortable = false) => {
        const th = document.createElement('th');
        if (sortable) {
            const isActive = currentSortColumn === key;
            const icon = isActive ? (currentSortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort';
            th.innerHTML = `
                <div class="sortable-header" onclick="toggleSort('${key}')" style="cursor: pointer; display: flex; align-items: center; gap: 8px;">
                    ${label} <i class="fas ${icon}" style="font-size: 12px; opacity: ${isActive ? 1 : 0.3}"></i>
                </div>
            `;
        } else {
            th.innerText = label;
        }
        return th;
    };

    thead.appendChild(createHeader('Rank', 'confluence_rank', true)).classList.add('col-rank');
    thead.appendChild(createHeader('Stock Detail', 'symbol', true)).classList.add('col-symbol');
    thead.appendChild(createHeader('LTP', 'ltp', true)).classList.add('col-ltp');
    thead.appendChild(createHeader('RSI', 'rsi', true)).classList.add('col-rsi');

    if (conf.ema.enabled) {
        thead.appendChild(createHeader(`EMA (${conf.ema.fast_period}/${conf.ema.slow_period})`, 'ema_signal', false));
    }
    if (conf.vol && conf.vol.enabled) {
        thead.appendChild(createHeader(`Volume (${conf.vol.threshold}x)`, 'volume_ratio', true));
    }

    thead.appendChild(createHeader('Strategy', 'trade_strategy', false)).classList.add('col-strategy');

    if (conf.patterns && conf.patterns.enabled) {
        const th = createHeader('Formation', 'candlestick_pattern', false);
        th.classList.add('formation-col');
        thead.appendChild(th);
    }

    if (conf.dma.enabled) {
        conf.dma.periods.forEach(p => {
            thead.appendChild(createHeader(`DMA ${p}`, `dma_${p}`, false));
        });
    }

    thead.appendChild(createHeader('Supertrend', 'supertrend_dir', false));
    thead.appendChild(createHeader('MTF', null, false));
    thead.appendChild(createHeader('Trade Plan', null, false));

    // Setup Column Toggle Dropdown
    setTimeout(() => setupColumnToggle('#main-signal-table', 'main-col-toggle-container'), 0);
}

function toggleSort(column) {
    if (currentSortColumn === column) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortColumn = column;
        currentSortDirection = 'desc';
    }
    updateTableHeader();
    renderSignals();
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

    // Filter by RSI Range
    const rsiMinInput = document.getElementById('filter-rsi-min');
    const rsiMaxInput = document.getElementById('filter-rsi-max');
    if (rsiMinInput && rsiMaxInput) {
        const rsiMin = parseFloat(rsiMinInput.value || 0);
        const rsiMax = parseFloat(rsiMaxInput.value || 100);
        displayData = displayData.filter(s => {
            if (s.rsi === null || s.rsi === undefined) return false;
            return s.rsi >= rsiMin && s.rsi <= rsiMax;
        });
    }

    // 3. Sort Data
    if (currentSortColumn) {
        displayData.sort((a, b) => {
            let valA = a[currentSortColumn];
            let valB = b[currentSortColumn];

            // Handle strings (like symbol)
            if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = (valB || '').toLowerCase();
                if (currentSortDirection === 'asc') return valA.localeCompare(valB);
                return valB.localeCompare(valA);
            }

            // Handle numbers
            valA = valA === null || valA === undefined ? (currentSortDirection === 'asc' ? Infinity : -Infinity) : valA;
            valB = valB === null || valB === undefined ? (currentSortDirection === 'asc' ? Infinity : -Infinity) : valB;

            if (currentSortDirection === 'asc') return valA - valB;
            return valB - valA;
        });
    }

    if (displayData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 40px; color: var(--text-dim);">No signals match your selected filters.</td></tr>`;
        return;
    }

    displayData.forEach(stock => {
        const score = stock.confluence_rank || 0;
        const row = document.createElement('tr');

        let rowHtml = `
            <td class="col-rank"><div class="rank-badge ${score >= 3 ? 'rank-high' : ''}" style="margin-top: 2px;">${score}</div></td>
            <td class="col-symbol">
                <div class="symbol-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${stock.symbol}</div>
                <div class="isin-code">${stock.isin}</div>
            </td>
            <td class="col-ltp"><div style="font-weight: 700; font-size: 15px;">₹${(stock.ltp).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div></td>
        `;

        // RSI
        if (conf.rsi.enabled) {
            const rsi = stock.rsi;
            const rsiH = stock.rsi_day_high;
            const rsiL = stock.rsi_day_low;
            if (rsi !== null && rsi !== undefined) {
                rowHtml += `
                    <td class="col-rsi">
                        <div class="${rsi > conf.rsi.ob ? 'text-success' : (rsi < conf.rsi.os ? 'text-danger' : '')}" style="font-weight: 600; font-size: 15px;">${rsi.toFixed(1)}</div>
                        <div style="font-size: 10px; color: var(--text-dim); margin-top: 3px; display: flex; gap: 6px;">
                            <span title="Day High" style="color: rgba(34, 197, 94, 0.7)">H: ${rsiH ? rsiH.toFixed(1) : '-'}</span>
                            <span title="Day Low" style="color: rgba(239, 68, 68, 0.7)">L: ${rsiL ? rsiL.toFixed(1) : '-'}</span>
                        </div>
                    </td>`;
            } else {
                rowHtml += `<td class="col-rsi"><div style="font-size: 15px; color: var(--text-dim);">-</div></td>`;
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
            <td class="col-strategy">
                <div class="strategy-badge ${stratClass}">${stratLabel}</div>
            </td>`;

        // Formation Column
        if (conf.patterns && conf.patterns.enabled) {
            let colHtml = `<td class="formation-col"><div style="display: flex; flex-direction: column; align-items: flex-start; gap: 6px; overflow: hidden;">`;

            const l5_data = stock.last_5_candles;
            let svgHtml = '';
            let rawDataJson = '';

            if (Array.isArray(l5_data) && l5_data.length > 0) {
                rawDataJson = encodeURIComponent(JSON.stringify(l5_data));

                let minLow = Infinity;
                let maxHigh = -Infinity;
                l5_data.forEach(c => {
                    if (c.l < minLow) minLow = c.l;
                    if (c.h > maxHigh) maxHigh = c.h;
                });

                // Safety buffer
                let range = maxHigh - minLow;
                if (range === 0) range = maxHigh * 0.01 || 1;

                // TradingView Aesthetic Adjustments
                const svgHeight = 28; // slightly taller for main row
                const candleWidth = 8;
                const gap = 4;
                const svgWidth = (candleWidth * 5) + (gap * 4);
                const pad = 2; // pixel padding top/bottom
                const usableHeight = svgHeight - (pad * 2);

                const patternLabel = stock.candlestick_pattern || '';
                let svgContent = `<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" style="cursor: pointer;" onclick="showCandlesPopup('${stock.isin}', '${stock.symbol}', this.dataset.pattern, this.dataset.candles)" data-candles="${rawDataJson}" data-pattern="${patternLabel}">`;

                l5_data.forEach((c, i) => {
                    const isGreen = c.c > c.o;
                    // Exact TradingView Hex Colors
                    const color = isGreen ? '#089981' : (c.c < c.o ? '#F23645' : '#787B86');
                    const xCenter = (i * (candleWidth + gap)) + (candleWidth / 2);

                    // Normalize coordinates (invert Y axis for SVG)
                    const yHigh = pad + usableHeight - ((c.h - minLow) / range) * usableHeight;
                    const yLow = pad + usableHeight - ((c.l - minLow) / range) * usableHeight;
                    const yOpen = pad + usableHeight - ((c.o - minLow) / range) * usableHeight;
                    const yClose = pad + usableHeight - ((c.c - minLow) / range) * usableHeight;

                    const topBody = Math.min(yOpen, yClose);
                    const bottomBody = Math.max(yOpen, yClose);
                    let bodyHeight = bottomBody - topBody;

                    if (Math.abs(c.c - c.o) < 0.0001) {
                        bodyHeight = Math.max(1.5, usableHeight * 0.02);
                    } else if (bodyHeight < 1) {
                        bodyHeight = 1;
                    }

                    svgContent += `<line x1="${xCenter}" y1="${yHigh}" x2="${xCenter}" y2="${yLow}" stroke="${color}" stroke-width="1.2" opacity="1.0" shape-rendering="crispEdges"/>`;

                    const rectX = xCenter - (candleWidth / 2);
                    svgContent += `<rect x="${rectX}" y="${topBody}" width="${candleWidth}" height="${bodyHeight}" fill="${color}" opacity="1.0" shape-rendering="crispEdges"/>`;
                });
                svgContent += `</svg>`;

                svgHtml = `
                <div title="Click to enlarge" style="
                    background: rgba(14, 21, 31, 0.4); 
                    border: 1px solid rgba(255,255,255,0.05); 
                    border-radius: 4px; 
                    padding: 6px 8px; 
                    display: inline-block;
                    transition: all 0.2s;
                " class="hover-scale">
                    ${svgContent}
                </div>`;
            }

            // Textual subtext logic
            const pattern = stock.candlestick_pattern;
            let textHtml = '';
            if (pattern) {
                let textColor = "var(--text-dim)";
                if (pattern.includes("Bullish")) textColor = "var(--success)";
                else if (pattern.includes("Bearish")) textColor = "var(--danger)";

                textHtml = `<div class="pattern-text" style="color: ${textColor};" title="${pattern}">${pattern}</div>`;
            }

            if (svgHtml) {
                colHtml += svgHtml;
                if (textHtml) colHtml += textHtml;
            } else if (textHtml) {
                colHtml += textHtml;
            } else {
                colHtml += `<div style="font-size: 13px; color: var(--text-dim);">-</div>`;
            }

            colHtml += `</div></td>`;
            rowHtml += colHtml;
        }

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

    if (conf.auto) {
        document.getElementById('setting-auto-fetch').checked = conf.auto.fetch;
        document.getElementById('setting-auto-calc').checked = conf.auto.calc;

        // Modal UI Switching
        if (profile === 'swing') {
            document.getElementById('auto-interval-container-swing').style.display = 'block';
            document.getElementById('auto-interval-container-intraday').style.display = 'none';
            document.getElementById('setting-auto-interval-swing').value = conf.auto.interval;
        } else {
            document.getElementById('auto-interval-container-swing').style.display = 'none';
            document.getElementById('auto-interval-container-intraday').style.display = 'block';
            document.getElementById('setting-auto-interval-intraday').value = conf.auto.interval;
        }

        const marketHoursEl = document.getElementById('setting-auto-market-hours');
        if (marketHoursEl) {
            marketHoursEl.checked = conf.auto.marketHoursOnly !== false; // Default to true
        }
    }

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
        const el = document.getElementById(`dma-${p}`);
        if (el) el.checked = conf.dma.periods.includes(p);
    });

    if (!conf.patterns) conf.patterns = { enabled: true, bullish: true, bearish: true, neutral: false };
    document.getElementById('setting-pattern-enabled').checked = conf.patterns.enabled;
    document.getElementById('setting-pattern-bullish').checked = conf.patterns.bullish;
    document.getElementById('setting-pattern-bearish').checked = conf.patterns.bearish;
    document.getElementById('setting-pattern-neutral').checked = conf.patterns.neutral;

    if (!conf.chart) conf.chart = { bars: 30, ema: true, st: true, dma: true, vol: true };
    document.getElementById('setting-chart-bars').value = conf.chart.bars;
    document.getElementById('setting-chart-ema').checked = conf.chart.ema;
    document.getElementById('setting-chart-st').checked = conf.chart.st;
    document.getElementById('setting-chart-dma').checked = conf.chart.dma;
    document.getElementById('setting-chart-vol').checked = conf.chart.vol;
}

function saveProfileSettings() {
    const profile = document.getElementById('config-profile-selector').value;
    const conf = CONFIGS[profile];

    if (!conf.auto) conf.auto = {};
    conf.auto.fetch = document.getElementById('setting-auto-fetch').checked;
    conf.auto.calc = document.getElementById('setting-auto-calc').checked;

    if (profile === 'swing') {
        conf.auto.interval = parseInt(document.getElementById('setting-auto-interval-swing').value);
    } else {
        conf.auto.interval = parseInt(document.getElementById('setting-auto-interval-intraday').value);
    }

    const marketHoursEl = document.getElementById('setting-auto-market-hours');
    if (marketHoursEl) {
        conf.auto.marketHoursOnly = marketHoursEl.checked;
    }

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
        const el = document.getElementById(`dma-${p}`);
        if (el && el.checked) conf.dma.periods.push(p);
    });

    if (!conf.patterns) conf.patterns = {};
    conf.patterns.enabled = document.getElementById('setting-pattern-enabled').checked;
    conf.patterns.bullish = document.getElementById('setting-pattern-bullish').checked;
    conf.patterns.bearish = document.getElementById('setting-pattern-bearish').checked;
    conf.patterns.neutral = document.getElementById('setting-pattern-neutral').checked;

    if (!conf.chart) conf.chart = {};
    conf.chart.bars = parseInt(document.getElementById('setting-chart-bars').value) || 30;
    conf.chart.ema = document.getElementById('setting-chart-ema').checked;
    conf.chart.st = document.getElementById('setting-chart-st').checked;
    conf.chart.dma = document.getElementById('setting-chart-dma').checked;
    conf.chart.vol = document.getElementById('setting-chart-vol').checked;

    if (currentMode === profile) {
        updateTableHeader();
        renderSignals();
    }

    if (isAutoSyncEnabled) {
        startAutoSync();
    }

    // Return to dashboard after save
    switchTab('dashboard');
}

function switchTab(tabId) {
    // Hide all main content views
    document.querySelectorAll('.main-content').forEach(el => el.classList.add('hidden'));

    // Show target view
    const target = document.getElementById(tabId + '-view');
    if (target) {
        target.classList.remove('hidden');
    }

    // Update sidebar navigation active state
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navItem = document.getElementById('nav-' + tabId);
    if (navItem) {
        navItem.classList.add('active');
    }

    // Trigger tab-specific logic
    if (tabId === 'settings') {
        loadProfileSettings();
    } else if (tabId === 'db-manager') {
        fetchDbStats();
    } else if (tabId === 'scenario-builder') {
        // Populate Auto-suggest datalist based on active mapped mode context
        const dataList = document.getElementById('sb-symbol-suggestions');
        if (dataList) {
            dataList.innerHTML = '';
            liveSignals.forEach(item => {
                if (item.symbol) {
                    const opt = document.createElement('option');
                    opt.value = item.symbol;
                    dataList.appendChild(opt);
                }
            });
        }
    }
}

async function fetchDbStats() {
    document.getElementById('db-coverage-tbody').innerHTML = '<tr><td colspan="5" style="text-align: center;"><i class="fas fa-spinner fa-spin"></i> Loading stats...</td></tr>';

    try {
        const res = await fetch('/api/db/stats');
        const result = await res.json();

        if (result.status === 'success') {
            document.getElementById('db-raw-rows').innerText = (result.data.raw_rows || 0).toLocaleString();
            document.getElementById('db-calc-rows').innerText = (result.data.calc_rows || 0).toLocaleString();

            const tbody = document.getElementById('db-coverage-tbody');
            tbody.innerHTML = '';

            if (Object.keys(result.data.coverage).length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;" class="text-dim">No raw OHLCV data found.</td></tr>';
            } else {
                for (const [tf, stats] of Object.entries(result.data.coverage)) {
                    tbody.innerHTML += `
                        <tr>
                            <td style="font-weight: 600;">${tf}</td>
                            <td>${stats.min_date || '-'}</td>
                            <td>${stats.max_date || '-'}</td>
                            <td style="color: var(--primary); font-weight: 700;">${stats.days || 0}</td>
                            <td>${(stats.count || 0).toLocaleString()}</td>
                        </tr>
                    `;
                }
            }
        }
    } catch (e) {
        console.error("Failed to load DB Stats", e);
        document.getElementById('db-coverage-tbody').innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--danger);">Failed to load stats</td></tr>';
    }
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').classList.add('hidden');
    document.getElementById('confirm-input').value = '';
}

async function clearDbData(type) {
    const modal = document.getElementById('confirm-modal');
    const msgEl = document.getElementById('confirm-modal-msg');
    const input = document.getElementById('confirm-input');
    const btn = document.getElementById('confirm-action-btn');
    const label = document.getElementById('confirm-type-label');

    let msg = "";
    let code = "CONFIRM";

    if (type === 'calculated') {
        msg = "You are about to delete all <strong>Calculated Indicator Signals</strong>. Market history will remain intact, but indicators will need to be recalculated on the next run.";
        code = "CLEAN";
    } else if (type === 'raw') {
        msg = "You are about to delete all <strong>Raw OHLCV Market Data</strong>. This will force the system to redownload everything from the Upstox API.";
        code = "DELETE";
    } else if (type === 'all') {
        msg = "<strong>CRITICAL WARNING:</strong> You are about to completely wipe the entire application database (Both signals and history). This action is irreversible.";
        code = "PURGE";
    }

    msgEl.innerHTML = msg;
    label.innerText = `Type "${code}" to authorize:`;
    input.placeholder = `Enter ${code}...`;
    modal.classList.remove('hidden');
    input.focus();

    btn.onclick = async () => {
        if (input.value.toUpperCase() !== code) {
            alert("Authorization code mismatch. Action cancelled.");
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

        try {
            const res = await fetch('/api/db/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target: type })
            });
            const result = await res.json();

            if (result.status === 'success') {
                closeConfirmModal();
                alert("Database task completed successfully.");
                fetchDbStats();
            } else {
                alert("Error: " + result.message);
            }
        } catch (e) {
            console.error(e);
            alert("Failed to communicate with the server.");
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Execute Action';
        }
    };
}


function toggleSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    const mainContent = document.querySelector('.main-content');
    sidebar.classList.toggle('collapsed');
    mainContent.classList.toggle('expanded');
}

// --- Auto Sync Logic ---

function toggleAutoSync() {
    isAutoSyncEnabled = document.getElementById('auto-sync-switch').checked;
    const label = document.getElementById('auto-sync-label');

    if (isAutoSyncEnabled) {
        label.innerText = "Auto-Sync: ON";
        label.style.color = "var(--primary)";
        startAutoSync();
        // Immediately trigger first cycle
        runAutoSyncLoop();
    } else {
        label.innerText = "Auto-Sync";
        label.style.color = "var(--text-dim)";
        if (autoSyncTimerId) {
            clearTimeout(autoSyncTimerId);
            autoSyncTimerId = null;
        }
    }
}

function startAutoSync() {
    if (autoSyncTimerId) clearTimeout(autoSyncTimerId);
    if (!isAutoSyncEnabled) return;

    const interval = CONFIGS[currentMode].auto.interval || 180000;
    autoSyncTimerId = setTimeout(runAutoSyncLoop, interval);
}

function runAutoSyncLoop() {
    if (!isAutoSyncEnabled) return;

    // Reschedule next cycle
    startAutoSync();

    const conf = CONFIGS[currentMode];

    // Check Market Hours if enabled
    if (conf.auto && conf.auto.marketHoursOnly) {
        // Simple client-side time check (assuming user is in IST or checking against local system time)
        // A more robust implementation would fetch server time, but this suffices for the UI toggle
        const now = new Date();

        // Adjust system date to IST for calculation
        // IST is UTC + 5:30 -> (5 * 60 + 30) = 330 minutes
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const istDate = new Date(utc + (3600000 * 5.5));

        const day = istDate.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
        const hours = istDate.getHours();
        const minutes = istDate.getMinutes();

        // Check if weekend
        if (day === 0 || day === 6) {
            console.log("Auto-Sync skipped: Market is closed (Weekend).");
            return;
        }

        // Check if outside 9:15 AM - 3:30 PM (15:30)
        const timeInMinutes = (hours * 60) + minutes;
        const marketOpen = (9 * 60) + 15; // 555
        const marketClose = (15 * 60) + 30; // 930

        if (timeInMinutes < marketOpen || timeInMinutes > marketClose) {
            console.log("Auto-Sync skipped: Outside of market hours (9:15 AM - 3:30 PM).");
            return;
        }
    }

    const fetchBtn = document.getElementById('fetch-data-btn');
    const refreshIcon = document.getElementById('refresh-icon');

    // Safety check to prevent overlapping runs or triggering during manual runs
    if (fetchEvtSource || fetchBtn.disabled || (refreshIcon && refreshIcon.classList.contains('fa-spin'))) {
        return;
    }

    if (conf.auto.fetch) {
        fetchMarketData();
    } else if (conf.auto.calc) {
        refreshSignals();
    }
}

async function fetchMarketData() {
    const btn = document.getElementById('fetch-data-btn');
    const container = document.getElementById('progress-container');
    const fill = document.getElementById('progress-fill');
    const percent = document.getElementById('progress-percent');
    const progText = container.querySelector('.progress-info span:first-child');
    const liveConsole = document.getElementById('live-console');
    const track = document.getElementById('progress-track-element');

    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';
    btn.disabled = true;

    const stopBtn = document.getElementById('stop-fetch-btn');
    if (stopBtn) stopBtn.style.display = 'block';

    container.classList.remove('hidden');
    liveConsole.classList.remove('hidden');
    track.classList.add('hidden'); // Hide fake bar
    liveConsole.innerHTML = ''; // clear logs
    if (progText) progText.innerText = `Streaming Upstox API Data (${currentMode.toUpperCase()})...`;

    const evtSource = new EventSource(`/api/stream/fetch-data?mode=${currentMode}`);
    fetchEvtSource = evtSource;

    evtSource.onmessage = function (event) {
        if (event.data === "[DONE]") {
            evtSource.close();
            fetchEvtSource = null;
            if (stopBtn) stopBtn.style.display = 'none';
            fetchSystemStatus();
            setTimeout(() => {
                container.classList.add('hidden');
                btn.innerHTML = originalHTML;
                btn.disabled = false;
                liveConsole.classList.add('hidden');
                track.classList.remove('hidden');

                if (isAutoSyncEnabled && CONFIGS[currentMode] && CONFIGS[currentMode].auto.calc) {
                    refreshSignals();
                }
            }, 1000);
            return;
        }
        const logLine = document.createElement('div');
        logLine.innerText = event.data;
        logLine.style.marginBottom = "4px";

        // Color coding
        if (event.data.includes("Planned:")) logLine.style.color = "var(--primary)";
        else if (event.data.includes("✅")) logLine.style.color = "var(--success)";
        else if (event.data.includes("Last available") || event.data.includes("No previous")) logLine.style.color = "var(--amber)";
        else if (event.data.includes("ERROR:") || event.data.includes("WARNING:")) logLine.style.color = "var(--danger)";

        liveConsole.appendChild(logLine);
        liveConsole.scrollTop = liveConsole.scrollHeight;
    };

    evtSource.onerror = function () {
        console.error("EventSource failed.");
        evtSource.close();
        fetchEvtSource = null;
        if (stopBtn) stopBtn.style.display = 'none';
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        fetchSystemStatus();
    };
}

async function stopFetch() {
    const stopBtn = document.getElementById('stop-fetch-btn');
    if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Stopping...';
    }

    try {
        const response = await fetch(`/api/stop-fetch?mode=${currentMode}`, { method: 'POST' });
        const result = await response.json();
        console.log(result.message);

        if (fetchEvtSource) {
            fetchEvtSource.close();
            fetchEvtSource = null;
        }

        // Reset UI immediately
        const btn = document.getElementById('fetch-data-btn');
        const container = document.getElementById('progress-container');
        const liveConsole = document.getElementById('live-console');
        const track = document.getElementById('progress-track-element');

        if (stopBtn) {
            stopBtn.style.display = 'none';
            stopBtn.disabled = false;
            stopBtn.innerHTML = '<i class="fas fa-stop-circle"></i> Stop Fetch';
        }

        if (btn) {
            btn.innerHTML = '<i class="fas fa-download"></i> Fetch Market Data';
            btn.disabled = false;
        }

        setTimeout(() => {
            if (container) container.classList.add('hidden');
            if (liveConsole) liveConsole.classList.add('hidden');
            if (track) track.classList.remove('hidden');
            fetchSystemStatus();
        }, 500);

    } catch (e) {
        console.error("Failed to stop fetch:", e);
        if (stopBtn) {
            stopBtn.disabled = false;
            stopBtn.innerHTML = '<i class="fas fa-stop-circle"></i> Stop Fetch';
        }
    }
}

async function refreshSignals() {
    const btnIcon = document.getElementById('refresh-icon');
    const container = document.getElementById('progress-container');
    const fill = document.getElementById('progress-fill');
    const percent = document.getElementById('progress-percent');
    const progText = container.querySelector('.progress-info span:first-child');

    container.classList.remove('hidden');
    if (progText) progText.innerText = 'Calculating Indicators & Strategies...';
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
        // 1. Manually trigger the Pandas-TA calculating backend for all timeframes
        await fetch(`/api/calculate?mode=${currentMode}`, {
            method: 'POST'
        });

        // 2. Fetch the newly populated data back into the frontend cache & UI
        await fetchAndRenderSignals(true); // force cache bust
        fetchSystemStatus();

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

// Consolidated switchTab logic above. Removed duplicate definition here.

async function runAdvancedBacktest() {
    const btn = document.getElementById('run-scenario-btn');
    const ogHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right: 8px;"></i> Running...';
    btn.disabled = true;

    // Collect variables
    const symbol = document.getElementById('sb-symbol').value || null;
    let actionSelect = document.getElementById('sb-action').value;
    const action = actionSelect.includes("BUY") ? "BUY" : "SELL";
    const primaryTfSelect = document.getElementById('sb-primary-tf').value;

    let primary_tf = '15m';
    if (primaryTfSelect.includes("30")) primary_tf = '30m';
    else if (primaryTfSelect.includes("Daily")) primary_tf = '1d';
    else if (primaryTfSelect.includes("Weekly")) primary_tf = '1w';
    else if (primaryTfSelect.includes("Monthly")) primary_tf = '1mo';

    const rsi_min = parseFloat(document.getElementById('sb-rsi-min').value);
    const rsi_max = parseFloat(document.getElementById('sb-rsi-max').value);
    const sl_pct = parseFloat(document.getElementById('sb-sl').value);
    const startDate = document.getElementById('sb-date-start').value;
    const endDate = document.getElementById('sb-date-end').value;

    if (!startDate || !endDate) {
        alert("Please set a Valid Start and End Date.");
        btn.innerHTML = ogHtml;
        btn.disabled = false;
        return;
    }

    const t1_weight = parseFloat(document.getElementById('sb-t1-weight')?.value || 50);
    const t2_weight = parseFloat(document.getElementById('sb-t2-weight')?.value || 50);
    const t1_price = parseFloat(document.getElementById('sb-t1-price')?.value || 0.49);
    const t2_price = parseFloat(document.getElementById('sb-t2-price')?.value || 0.90);

    const tr1_weight = parseFloat(document.getElementById('sb-tr1-weight')?.value || 50);
    const tr2_weight = parseFloat(document.getElementById('sb-tr2-weight')?.value || 25);
    const tr3_weight = parseFloat(document.getElementById('sb-tr3-weight')?.value || 25);

    const tr2_price = parseFloat(document.getElementById('sb-tr2-price')?.value || 0.1);
    const tr3_price = parseFloat(document.getElementById('sb-tr3-price')?.value || 0.1);

    let symbolsList = [];
    if (!symbol || symbol.trim() === '') {
        symbolsList = liveSignals.map(s => s.symbol).filter(s => !!s);
    }

    const payload = {
        symbol: symbol,
        symbols: symbolsList,
        start_date: startDate,
        end_date: endDate,
        primary_tf: primary_tf,
        action: action,
        rsi_min: rsi_min,
        rsi_max: rsi_max,
        stop_loss_pct: sl_pct,
        t1_weight: t1_weight,
        t2_weight: t2_weight,
        t1_price: t1_price,
        t2_price: t2_price,
        tranche_weights: [tr1_weight, tr2_weight, tr3_weight],
        tranche_prices: [tr2_price, tr3_price]
    };

    try {
        const response = await fetch('/api/backtest/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        lastBacktestData = result.status === 'success' ? (result.data || []) : [];
        drawBacktestGrid('ALL');

    } catch (err) {
        console.error(err);
        alert("Backtest Failed. See console.");
    } finally {
        btn.innerHTML = ogHtml;
        btn.disabled = false;
    }
}

let lastBacktestData = [];

function drawBacktestGrid(symbolFilter = 'ALL') {
    const grid = document.getElementById('sb-results-grid');
    if (!lastBacktestData || lastBacktestData.length === 0) {
        grid.innerHTML = `
            <div style="background: rgba(0,0,0,0.2); border: 1px dashed var(--border-color); border-radius: 12px; padding: 60px; text-align: center; color: var(--text-dim);">
                <i class="fas fa-exclamation-triangle fa-3x" style="margin-bottom: 16px; opacity: 0.5;"></i>
                <h3 style="font-weight: 500;">No Trades Executed</h3>
                <p style="font-size: 13px;">The selected parameters did not trigger any entries within the specified date range.</p>
            </div>
        `;
        return;
    }

    // Apply Filter
    let displayData = symbolFilter === 'ALL' ? lastBacktestData : lastBacktestData.filter(d => d.symbol === symbolFilter);

    // Compute stats
    const totalTrades = displayData.length;
    const winners = displayData.filter(d => d.pnl_pct > 0).length;
    const winRate = totalTrades > 0 ? ((winners / totalTrades) * 100).toFixed(1) : 0;
    let totalPnl = 0;
    displayData.forEach(d => totalPnl += d.pnl_pct);

    // Get unique symbols for the filter dropdown
    const uniqueSymbols = [...new Set(lastBacktestData.map(d => d.symbol))].sort();
    let filterOptionsHtml = `<option value="ALL" ${symbolFilter === 'ALL' ? 'selected' : ''}>All Symbols</option>`;
    uniqueSymbols.forEach(sym => {
        filterOptionsHtml += `<option value="${sym}" ${symbolFilter === sym ? 'selected' : ''}>${sym}</option>`;
    });

    // Create new stats container at top of grid
    let html = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; background: var(--card-bg); padding: 12px 16px; border-radius: 8px; border: 1px solid var(--border-color);">
        <div style="display: flex; align-items: center; gap: 12px;">
            <i class="fas fa-filter text-dim"></i>
            <span style="font-size: 13px; font-weight: 600;">Symbol Filter:</span>
            <select class="select-input" style="width: auto; padding: 6px 12px; font-size: 13px;" onchange="drawBacktestGrid(this.value)">
                ${filterOptionsHtml}
            </select>
        </div>
        <div style="font-size: 12px; color: var(--text-dim);">
            Filtering <strong class="text-main">${totalTrades}</strong> trades out of <strong class="text-main">${lastBacktestData.length}</strong> total.
        </div>
    </div>
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px;">
        <div style="background: var(--card-bg); padding: 16px; border-radius: 8px; border: 1px solid var(--border-color); text-align: center;">
            <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 4px;">Total Trades</div>
            <div style="font-size: 20px; font-weight: 700;">${totalTrades}</div>
        </div>
        <div style="background: var(--card-bg); padding: 16px; border-radius: 8px; border: 1px solid var(--border-color); text-align: center;">
            <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 4px;">Win Rate</div>
            <div style="font-size: 20px; font-weight: 700;">${winRate}%</div>
        </div>
        <div style="background: var(--card-bg); padding: 16px; border-radius: 8px; border: 1px solid var(--border-color); text-align: center;">
            <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 4px;">Net Profit</div>
            <div style="font-size: 20px; font-weight: 700;" class="${totalPnl > 0 ? 'text-success' : (totalPnl < 0 ? 'text-danger' : '')}">${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(2)}%</div>
        </div>
    </div>
    <table class="signal-table" id="bt-signal-table" style="width: 100%; text-align: left; font-size: 13px;">
            <thead>
                <tr style="background: rgba(255,255,255,0.05);">
                    <th style="padding: 12px; border-bottom: 1px solid var(--border-color);">Date / Time</th>
                    <th style="padding: 12px; border-bottom: 1px solid var(--border-color);">Symbol</th>
                    <th style="padding: 12px; border-bottom: 1px solid var(--border-color);">Action</th>
                    <th style="padding: 12px; border-bottom: 1px solid var(--border-color);">Avg Entry</th>
                    <th style="padding: 12px; border-bottom: 1px solid var(--border-color);">Tranches</th>
                    <th style="padding: 12px; border-bottom: 1px solid var(--border-color);">Exit Price</th>
                    <th style="padding: 12px; border-bottom: 1px solid var(--border-color);">Exit Trigger</th>
                    <th style="padding: 12px; border-bottom: 1px solid var(--border-color); text-align: right;">P&L (%)</th>
                </tr>
            </thead>
            <tbody>
    `;

    displayData.forEach(d => {
        const pnlColor = d.pnl_pct > 0 ? 'var(--success)' : 'var(--danger)';
        const dateObj = new Date(d.timestamp);
        const dateStr = dateObj.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        let trancheDisplay = d.tranches;
        if (d.tranches === 1) trancheDisplay = "1 (50%)";
        if (d.tranches === 2) trancheDisplay = "1, 2 (75%)";
        if (d.tranches === 3) trancheDisplay = "1, 2, 3 (100%)";

        html += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.02);">
                <td style="padding: 12px;">${dateStr}</td>
                <td style="padding: 12px; font-weight: 600;">${d.symbol}</td>
                <td style="padding: 12px;">${d.action}</td>
                <td style="padding: 12px;">₹${d.avg_entry.toFixed(2)}</td>
                <td style="padding: 12px; color: var(--text-dim);">${trancheDisplay}</td>
                <td style="padding: 12px;">₹${d.exit_price.toFixed(2)}</td>
                <td style="padding: 12px;">${d.exit_trigger}</td>
                <td style="padding: 12px; text-align: right; color: ${pnlColor}; font-weight: 600;">${d.pnl_pct > 0 ? '+' : ''}${d.pnl_pct.toFixed(2)}%</td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    grid.innerHTML = html;

    setTimeout(() => setupColumnToggle('#bt-signal-table', 'bt-col-toggle-container'), 0);
}

// Initialized via DOMContentLoaded below.

function setupRSISlider() {
    const minInput = document.getElementById('filter-rsi-min');
    const maxInput = document.getElementById('filter-rsi-max');
    const rangeTrack = document.getElementById('rsi-slider-range');
    const label = document.getElementById('rsi-range-label');

    if (!minInput || !maxInput || !rangeTrack || !label) return;

    function updateSlider() {
        let minVal = parseInt(minInput.value);
        let maxVal = parseInt(maxInput.value);

        // Prevent crossing
        if (minVal > maxVal - 5) {
            if (this === minInput) {
                minInput.value = maxVal - 5;
                minVal = maxVal - 5;
            } else {
                maxInput.value = minVal + 5;
                maxVal = minVal + 5;
            }
        }

        // Update Visual Track
        rangeTrack.style.left = (minVal) + '%';
        rangeTrack.style.width = (maxVal - minVal) + '%';

        // Update Label
        label.innerText = `${minVal} - ${maxVal}`;

        // Trigger Render
        renderSignals();
    }

    minInput.oninput = updateSlider;
    maxInput.oninput = updateSlider;

    // Initial run
    updateSlider();
}

// --- Column Toggle Logic ---
let tableColumnStates = {};

function setupColumnToggle(tableSelector, containerId) {
    const table = document.querySelector(tableSelector);
    const container = document.getElementById(containerId);
    if (!table || !container) return;

    const headers = table.querySelectorAll('thead th');
    if (headers.length === 0) return;

    // Default all columns to visible if not state stored or config changed
    if (!tableColumnStates[tableSelector] || tableColumnStates[tableSelector].length !== headers.length) {
        tableColumnStates[tableSelector] = Array.from(headers).map(th => {
            const text = th.textContent.trim();
            // Default these specific columns to hidden
            return text !== 'Strategy' && text !== 'Trade Plan';
        });
    }

    let html = `
    <div style="position: relative; display: inline-block;">
        <button class="btn" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); color: var(--text-main);" onclick="this.nextElementSibling.classList.toggle('hidden')">
            <i class="fas fa-columns"></i> Columns
        </button>
        <div class="hidden column-toggle-dropdown" style="position: absolute; right: 0; margin-top: 5px; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(8px); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; z-index: 100; min-width: 180px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
    `;

    headers.forEach((th, index) => {
        const headerText = th.textContent.trim() || `Col ${index + 1}`;
        const isChecked = tableColumnStates[tableSelector][index] ? 'checked' : '';
        html += `
            <label style="display: block; margin-bottom: 8px; font-size: 13px; cursor: pointer; color: var(--text-dim); display: flex; align-items: center; gap: 8px;">
                <input type="checkbox" ${isChecked} onchange="toggleTableColumn('${tableSelector}', ${index}, this.checked)" style="accent-color: var(--primary);">
                ${headerText}
            </label>
        `;
    });

    html += `</div></div>`;
    container.innerHTML = html;
    applyTableColumnStyles();
}

function toggleTableColumn(tableSelector, colIndex, isVisible) {
    tableColumnStates[tableSelector][colIndex] = isVisible;
    applyTableColumnStyles();
}

function applyTableColumnStyles() {
    let styleEl = document.getElementById('dynamic-column-styles');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'dynamic-column-styles';
        document.head.appendChild(styleEl);
    }

    let css = '';
    for (const [tableSelector, states] of Object.entries(tableColumnStates)) {
        states.forEach((isVisible, index) => {
            if (!isVisible) {
                // nth-child is 1-indexed (index + 1)
                css += `
                    ${tableSelector} th:nth-child(${index + 1}),
                    ${tableSelector} td:nth-child(${index + 1}) {
                        display: none !important;
                    }
                `;
            }
        });
    }
    styleEl.innerHTML = css;
}

// Close Dropdowns on outside click automatically
document.addEventListener('click', function (event) {
    if (!event.target.closest('.column-toggle-dropdown') && !event.target.closest('[onclick*="classList.toggle"]')) {
        document.querySelectorAll('.column-toggle-dropdown').forEach(d => d.classList.add('hidden'));
    }
});

// --- Candle Zoom Modal with Indicators ---
if (typeof fullChartCache === 'undefined') {
    var fullChartCache = {};
}

async function showCandlesPopup(isin, symbol, patternName = '', fallbackCandlesJson = '') {
    const config = CONFIGS[currentMode];
    const chartOpts = config.chart || { bars: 30, ema: true, st: true, dma: true, vol: true };
    const barsRequested = chartOpts.bars || 30;

    // Determine timeframe string for display
    const tfDisplay = currentTimeframe || "Daily";

    // Create/Reuse Modal
    let modal = document.getElementById('candle-zoom-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'candle-zoom-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.85); backdrop-filter: blur(8px);
            z-index: 9999; display: flex; align-items: center; justify-content: center;
        `;
        document.body.appendChild(modal);
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    }

    // Initial Loading UI
    modal.innerHTML = `
        <div style="background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: 16px; padding: 24px; width: 900px; max-width: 95vw; box-shadow: 0 20px 60px rgba(0,0,0,0.6); position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
                <div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <h3 style="margin: 0; font-size: 22px; font-weight: 700;">${symbol}</h3>
                        <span style="padding: 2px 8px; background: rgba(255,255,255,0.05); border-radius: 4px; font-size: 11px; color: var(--text-dim); border: 1px solid var(--border-color);">${tfDisplay}</span>
                    </div>
                     ${patternName ? `
                        <div style="margin-top: 6px; font-size: 14px; font-weight: 600; color: ${patternName.includes('Bullish') ? 'var(--success)' : (patternName.includes('Bearish') ? 'var(--danger)' : 'var(--text-main)')};">
                            Condition: ${patternName}
                        </div>
                    ` : ''}
                </div>
                <button onclick="document.getElementById('candle-zoom-modal').style.display='none'" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); color: var(--text-dim); cursor: pointer; font-size: 20px; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">&times;</button>
            </div>
            
            <div id="zoom-chart-content" style="min-height: 400px; display: flex; align-items: center; justify-content: center;">
                <div style="text-align: center; color: var(--text-dim);">
                    <i class="fas fa-spinner fa-spin fa-2x" style="margin-bottom: 12px; color: var(--primary);"></i>
                    <p>Loading High-Detail Chart...</p>
                </div>
            </div>
            
            <div id="zoom-chart-legend" style="margin-top: 16px; display: flex; gap: 16px; font-size: 11px; flex-wrap: wrap;"></div>
        </div>
    `;
    modal.style.display = 'flex';

    // Fetch Enriched Data
    const cacheKey = `${isin}_${tfDisplay}_${barsRequested}`;
    let chartData = fullChartCache[cacheKey];

    if (!chartData) {
        try {
            const apiTf = TF_MAP[currentTimeframe] || '1d';
            const res = await fetch(`/api/chart/details?isin=${isin}&timeframe=${apiTf}&profile=${currentMode}&bars=${barsRequested}`);
            const result = await res.json();
            if (result.status === 'success') {
                chartData = result.data;
                fullChartCache[cacheKey] = chartData;
            }
        } catch (err) {
            console.error("Chart fetch failed", err);
        }
    }

    if (!chartData && fallbackCandlesJson) {
        chartData = JSON.parse(decodeURIComponent(fallbackCandlesJson));
    }

    if (chartData && chartData.length > 0) {
        renderEnrichedChart(chartData, symbol, chartOpts, tfDisplay);
    } else {
        document.getElementById('zoom-chart-content').innerHTML = `
            <div style="color: var(--danger); text-align: center;">
                <i class="fas fa-exclamation-triangle fa-2x" style="margin-bottom: 12px;"></i>
                <p>Failed to load detailed chart data.</p>
            </div>
        `;
    }
}

function renderEnrichedChart(candles, symbol, opts, tfDisplay) {
    const container = document.getElementById('zoom-chart-content');
    const legend = document.getElementById('zoom-chart-legend');
    container.innerHTML = '';
    legend.innerHTML = '';

    // 1. Calculate Scaling
    let minL = Infinity;
    let maxH = -Infinity;
    let maxV = 0;

    candles.forEach(c => {
        if (c.l < minL) minL = c.l;
        if (c.h > maxH) maxH = c.h;
        if (c.v > maxV) maxV = c.v;

        // Include indicator values in scale
        if (opts.ema) {
            Object.keys(c).forEach(key => {
                if (key.startsWith('EMA_') && c[key]) {
                    if (c[key] < minL) minL = c[key];
                    if (c[key] > maxH) maxH = c[key];
                }
            });
        }
        if (opts.st && c.ST_value) {
            if (c.ST_value < minL) minL = c.ST_value;
            if (c.ST_value > maxH) maxH = c.ST_value;
        }
    });

    let priceRange = maxH - minL;
    if (priceRange === 0) priceRange = maxH * 0.05 || 1;
    maxH += priceRange * 0.08;
    minL -= priceRange * 0.08;
    priceRange = maxH - minL;

    // 2. SVG Dimensions
    const svgWidth = container.clientWidth || 850;
    const svgHeight = 400;
    const chartPaddingRight = 70;
    const chartAreaWidth = svgWidth - chartPaddingRight;
    const padTop = 30;
    const padBottom = 50;
    const usableHeight = svgHeight - padTop - padBottom;

    const candleCount = candles.length;
    const barWidth = (chartAreaWidth / candleCount) * 0.75;
    const gap = (chartAreaWidth / candleCount) * 0.25;

    let svg = `<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" style="background: #0d1117; border-radius: 8px;">`;

    // 3. Grid Lines & Price Labels
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
        const yLine = padTop + (usableHeight / steps) * i;
        const priceVal = maxH - (priceRange / steps) * i;
        svg += `<line x1="0" y1="${yLine}" x2="${chartAreaWidth}" y2="${yLine}" stroke="rgba(255,255,255,0.05)" stroke-width="1" />`;
        svg += `<text x="${chartAreaWidth + 10}" y="${yLine + 4}" fill="var(--text-dim)" font-size="11" font-family="sans-serif">${priceVal.toFixed(2)}</text>`;
    }

    // 4. Draw Indicators (Polylines)
    // EMA Lines
    if (opts.ema) {
        const emaKeys = Object.keys(candles[0]).filter(k => k.startsWith('EMA_'));
        const colors = ['#2962FF', '#FF9800', '#E91E63'];
        emaKeys.forEach((key, idx) => {
            let points = "";
            candles.forEach((c, i) => {
                const val = c[key];
                if (val) {
                    const x = (i * (barWidth + gap)) + (barWidth / 2) + 5;
                    const y = padTop + usableHeight - ((val - minL) / priceRange) * usableHeight;
                    points += `${x},${y} `;
                }
            });
            const color = colors[idx % colors.length];
            svg += `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.8" />`;
            legend.innerHTML += `<div style="display:flex; align-items:center; gap:6px;"><div style="width:10px; height:10px; border-radius:3px; background:${color}"></div>${key}</div>`;
        });
    }

    // Supertrend
    if (opts.st) {
        let stPoints = "";
        candles.forEach((c, i) => {
            if (c.ST_value) {
                const x = (i * (barWidth + gap)) + (barWidth / 2) + 5;
                const y = padTop + usableHeight - ((c.ST_value - minL) / priceRange) * usableHeight;
                stPoints += `${x},${y} `;
            }
        });
        if (stPoints) {
            svg += `<polyline points="${stPoints}" fill="none" stroke="rgba(245, 158, 11, 1.0)" stroke-width="2" stroke-dasharray="4 2" />`;
            legend.innerHTML += `<div style="display:flex; align-items:center; gap:6px;"><div style="width:10px; height:2px; background:#f59e0b"></div>Supertrend</div>`;
        }
    }

    // DMA References (Horizontal Lines)
    if (opts.dma) {
        const dmaKeys = Object.keys(candles[0]).filter(k => k.startsWith('DMA_'));
        dmaKeys.forEach((key) => {
            const val = candles[0][key];
            if (val && val >= minL && val <= maxH) {
                const y = padTop + usableHeight - ((val - minL) / priceRange) * usableHeight;
                svg += `<line x1="0" y1="${y}" x2="${chartAreaWidth}" y2="${y}" stroke="rgba(168, 85, 247, 0.4)" stroke-width="1" stroke-dasharray="8 4" />`;
                svg += `<text x="5" y="${y - 4}" fill="rgba(168, 85, 247, 0.8)" font-size="9">${key}</text>`;
            }
        });
    }

    // 5. Volume Bars (Background)
    if (opts.vol && maxV > 0) {
        candles.forEach((c, i) => {
            const vHeight = (c.v / maxV) * (usableHeight * 0.2);
            const x = (i * (barWidth + gap)) + 5;
            const y = svgHeight - padBottom - vHeight;
            const color = c.c >= c.o ? 'rgba(8, 153, 129, 0.15)' : 'rgba(242, 54, 69, 0.15)';
            svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${vHeight}" fill="${color}" />`;
        });
    }

    // 6. Draw Candles
    candles.forEach((c, i) => {
        const isGreen = c.c >= c.o;
        const color = isGreen ? '#089981' : '#F23645';
        const xCenter = (i * (barWidth + gap)) + (barWidth / 2) + 5;

        const yHigh = padTop + usableHeight - ((c.h - minL) / priceRange) * usableHeight;
        const yLow = padTop + usableHeight - ((c.l - minL) / priceRange) * usableHeight;
        const yOpen = padTop + usableHeight - ((c.o - minL) / priceRange) * usableHeight;
        const yClose = padTop + usableHeight - ((c.c - minL) / priceRange) * usableHeight;

        const topBody = Math.min(yOpen, yClose);
        const bottomBody = Math.max(yOpen, yClose);
        let bodyH = Math.max(1, bottomBody - topBody);

        svg += `<line x1="${xCenter}" y1="${yHigh}" x2="${xCenter}" y2="${yLow}" stroke="${color}" stroke-width="1.5" />`;
        svg += `<rect x="${xCenter - (barWidth / 2)}" y="${topBody}" width="${barWidth}" height="${bodyH}" fill="${color}" />`;
    });

    // 7. Crosshair interactivity
    svg += `<line id="ch-x" x1="0" y1="0" x2="0" y2="${svgHeight}" stroke="rgba(255,255,255,0.4)" stroke-dasharray="4 4" style="display:none; pointer-events:none;"/>`;
    svg += `<line id="ch-y" x1="0" y1="0" x2="${svgWidth}" y2="0" stroke="rgba(255,255,255,0.4)" stroke-dasharray="4 4" style="display:none; pointer-events:none;"/>`;
    svg += `<text id="ch-ohlc" x="10" y="20" fill="var(--text-dim)" font-size="12" font-family="sans-serif"></text>`;

    svg += `</svg>`;
    container.innerHTML = svg;

    const svgEl = container.querySelector('svg');
    const chX = document.getElementById('ch-x');
    const chY = document.getElementById('ch-y');
    const chOhlc = document.getElementById('ch-ohlc');

    svgEl.onmousemove = (e) => {
        const r = svgEl.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;

        chX.style.display = 'block';
        chY.style.display = 'block';
        chX.setAttribute('x1', x); chX.setAttribute('x2', x);
        chY.setAttribute('y1', y); chY.setAttribute('y2', y);

        // Nearest Candle
        const idx = Math.floor(x / (barWidth + gap));
        if (idx >= 0 && idx < candles.length) {
            const c = candles[idx];
            const color = c.c >= c.o ? '#089981' : '#F23645';
            chOhlc.innerHTML = `${c.t} | O:${c.o.toFixed(1)} H:${c.h.toFixed(1)} L:${c.l.toFixed(1)} C:<tspan fill="${color}">${c.c.toFixed(1)}</tspan>`;

            // Snap X
            const snapX = (idx * (barWidth + gap)) + (barWidth / 2) + 5;
            chX.setAttribute('x1', snapX); chX.setAttribute('x2', snapX);
        }
    };
    svgEl.onmouseleave = () => {
        chX.style.display = 'none'; chY.style.display = 'none';
    };
}

// --- App Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("App Initialized. Defaulting to Swing Dashboard.");
    setMode('swing');
    switchTab('dashboard');
    setupRSISlider(); // Initialize Dual RSI Slider
});
