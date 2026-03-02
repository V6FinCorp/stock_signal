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
        fundamentals: { enabled: true },
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
        fundamentals: { enabled: true },
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
let activeSectorFilter = 'all';
let isSectorBarCollapsed = false;
let activeTab = 'dashboard';
let appZoom = 1.0;
let screenerMasterData = []; // Cache for local screener filtering

let HUD_STATES = {
    swing: { active: false, expanded: false },
    intraday: { active: false, expanded: false }
};

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
    updateSectorSentiment();
}

// --- UI Logic ---

function setStatFilter(filterType) {
    activeStatFilter = filterType;
    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active-filter'));
    document.getElementById(`card-${filterType}`).classList.add('active-filter');
    renderSignals();
}

function setMode(mode) {
    console.log(`Setting Mode: ${mode}`);
    const oldMode = currentMode;
    currentMode = mode;
    currentTimeframe = MODES[mode].defaultTF;

    // Pulse navigation
    document.querySelectorAll('#mode-swing, #mode-intraday').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`mode-${mode}`).classList.add('active');

    // Update ALL page titles to reflect the context globally
    const modeLabel = mode === 'swing' ? 'Swing' : 'Intraday';

    const dashboardTitle = document.getElementById('page-title');
    if (dashboardTitle) dashboardTitle.innerText = `${modeLabel} Trading Dashboard`;

    const proTitle = document.getElementById('page-title-pro');
    if (proTitle) proTitle.innerText = `High-Conviction ${modeLabel} Screener`;

    const settingsTitle = document.getElementById('page-title-settings');
    if (settingsTitle) settingsTitle.innerText = `${modeLabel} Engine Configuration`;

    // Clear local cache when switching modes to prevent any data "bleeding" or staleness
    if (oldMode !== mode) {
        signalCache = {};
        screenerMasterData = [];
    }

    // HUD Context Sync
    syncHudVisibility();

    // Logic to refresh whatever view the user is on strictly
    if (activeTab === 'dashboard') {
        renderTimeframes();
        updateTableHeader();
        fetchAndRenderSignals(true); // Force fetch on mode switch
    } else if (activeTab === 'pro-screener') {
        renderProScreener();
    } else if (activeTab === 'settings') {
        loadProfileSettings();
    } else if (activeTab === 'strategy-lab') {
        updateStrategyLabOptions();
    }

    fetchSystemStatus();
    updateSectorSentiment();
}

function updateStrategyLabOptions() {
    const mode = currentMode;
    const select = document.getElementById('strat-timeframe');
    if (!select) return;

    // Clear and build options based on mode
    const options = mode === 'swing'
        ? [["1d", "Daily"], ["1w", "Weekly"], ["1mo", "Monthly"]]
        : [["5m", "5 Minute"], ["15m", "15 Minute"], ["30m", "30 Minute"], ["60m", "1 Hour"]];

    select.innerHTML = options.map(([val, label]) =>
        `<option value="${val}">${label}</option>`
    ).join('');

    // Update styling context of the Lab based on mode
    const entryBox = document.getElementById('strat-entry-query');
    if (entryBox) {
        if (mode === 'intraday') {
            entryBox.style.border = "1px solid rgba(245, 158, 11, 0.3)"; // Amber for intraday
        } else {
            entryBox.style.border = "1px solid rgba(16, 185, 129, 0.3)"; // Success Green for swing
        }
    }
}

// --- Zoom Logic ---
function adjustZoom(delta) {
    appZoom = Math.min(Math.max(appZoom + delta, 0.5), 1.5);
    applyZoom();
}

function resetZoom() {
    appZoom = 1.0;
    applyZoom();
}

function applyZoom() {
    document.body.style.zoom = appZoom;
    const textEl = document.getElementById('zoom-level-text');
    if (textEl) textEl.innerText = `${Math.round(appZoom * 100)}%`;
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

    if (conf.fundamentals && conf.fundamentals.enabled) {
        thead.appendChild(createHeader('Industry Group', 'i_group', true)).classList.add('col-sector');
    }

    thead.appendChild(createHeader('LTP', 'ltp', true)).classList.add('col-ltp');

    // Only show PE and ROE in Swing mode as they are too static for Intraday
    if (conf.fundamentals && conf.fundamentals.enabled && currentMode === 'swing') {
        thead.appendChild(createHeader('PE', 'pe', true)).classList.add('col-pe');
        thead.appendChild(createHeader('ROE', 'roe', true)).classList.add('col-roe');
    }

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

        const thText = createHeader('Pattern Name', 'candlestick_pattern', false);
        thText.classList.add('pattern-name-col');
        thead.appendChild(thText);
    }

    if (conf.dma.enabled) {
        conf.dma.periods.forEach(p => {
            thead.appendChild(createHeader(`DMA ${p}`, `dma_${p}`, false));
        });
    }

    thead.appendChild(createHeader('Supertrend', 'supertrend_dir', false));
    thead.appendChild(createHeader('MTF', null, false));
    thead.appendChild(createHeader('Trade Plan', null, false));
    thead.appendChild(createHeader('Action', null, false));

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
    const confluence = liveSignals.filter(s => Math.abs(s.confluence_rank) >= 3).length;
    document.getElementById('stat-confluence').innerText = confluence.toLocaleString();

    // 2. Filter Data
    let displayData = liveSignals;

    // Filter by active stat card
    if (activeStatFilter === 'bullish') {
        displayData = displayData.filter(s => s.supertrend_dir === 'BUY');
    } else if (activeStatFilter === 'bearish') {
        displayData = displayData.filter(s => s.supertrend_dir === 'SELL');
    } else if (activeStatFilter === 'confluence') {
        displayData = displayData.filter(s => Math.abs(s.confluence_rank) >= 3);
    }

    // Filter by rank dropdown
    const filterRank = document.getElementById('filter-rank') ? document.getElementById('filter-rank').value : 'all';
    if (filterRank !== 'all') {
        if (filterRank === 'top') {
            displayData = displayData.filter(s => Math.abs(s.confluence_rank) >= 4);
        } else {
            const minRank = parseInt(filterRank);
            if (minRank > 0) {
                displayData = displayData.filter(s => s.confluence_rank >= minRank);
            } else {
                displayData = displayData.filter(s => s.confluence_rank <= minRank);
            }
        }
    }

    // Filter by Sector
    if (activeSectorFilter !== 'all') {
        displayData = displayData.filter(s => s.i_group === activeSectorFilter);
    }

    // Filter by Search Input
    const searchQuery = document.getElementById('search-input') ? document.getElementById('search-input').value.trim().toUpperCase() : '';
    if (searchQuery) {
        displayData = displayData.filter(s =>
            (s.symbol || "").toUpperCase().includes(searchQuery) ||
            (s.isin || "").toUpperCase().includes(searchQuery)
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

        let rankClass = '';
        if (score >= 3) rankClass = 'rank-high';
        else if (score <= -3) rankClass = 'rank-low';

        rowHtml = `
            <td class="col-rank"><div class="rank-badge ${rankClass}" style="margin-top: 2px;">${score > 0 ? '+' : ''}${score}</div></td>
            <td class="col-symbol">
                <div class="symbol-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${stock.symbol}</div>
                <div class="isin-code">${stock.isin}</div>
            </td>
        `;

        if (conf.fundamentals && conf.fundamentals.enabled) {
            rowHtml += `
                <td class="col-sector">
                    <div style="font-size: 13px; color: var(--text-main); font-weight: 500; overflow: hidden; text-overflow: ellipsis; max-width: 140px;" title="${stock.i_group || '-'}">${stock.i_group || '-'}</div>
                    <div style="font-size: 10px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; max-width: 140px; margin-top: 2px;" title="${stock.i_subgroup || '-'}">${stock.i_subgroup || '-'}</div>
                </td>
            `;
        }

        rowHtml += `<td class="col-ltp"><div style="font-weight: 700; font-size: 15px;">${(stock.ltp).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div></td>`;

        if (conf.fundamentals && conf.fundamentals.enabled && currentMode === 'swing') {
            rowHtml += `
                <td class="col-pe"><div style="font-size: 14px; font-weight: 600;">${stock.pe ? stock.pe.toFixed(1) : '-'}</div></td>
                <td class="col-roe"><div class="font-bold ${stock.roe > 15 ? 'text-success' : ''}" style="font-size: 14px;">${stock.roe ? stock.roe.toFixed(1) + '%' : '-'}</div></td>
            `;
        }

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
        if (strat === 'PERFECT_BUY') { stratClass = 'bg-perfect'; stratLabel = 'Perfect Buy'; }
        else if (strat === 'PERFECT_SELL') { stratClass = 'bg-perfect-sell'; stratLabel = 'Perfect Sell'; }
        else if (strat === 'DMA_BOUNCE') { stratClass = 'bg-bounce'; stratLabel = 'Support Bounce'; }
        else if (strat === 'DMA_RESISTANCE') { stratClass = 'bg-resistance'; stratLabel = 'Resistance'; }
        else if (strat === 'OVEREXTENDED') { stratClass = 'bg-stretch'; stratLabel = 'Stretched'; }

        rowHtml += `
            <td class="col-strategy">
                <div class="strategy-badge ${stratClass}">${stratLabel}</div>
            </td>`;

        // Formation & Pattern Columns
        if (conf.patterns && conf.patterns.enabled) {
            let sparklineHtml = `<td class="formation-col"><div style="display: flex; flex-direction: column; align-items: flex-start; gap: 6px; overflow: hidden;">`;
            let patternNameHtml = `<td class="pattern-name-col">`;

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
                const svgHeight = 28;
                const candleWidth = 8;
                const gap = 4;
                const svgWidth = (candleWidth * 5) + (gap * 4);
                const pad = 2;
                const usableHeight = svgHeight - (pad * 2);

                const patternLabel = stock.candlestick_pattern || '';
                let svgContent = `<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" style="cursor: pointer;" onclick="showCandlesPopup('${stock.isin}', '${stock.symbol}', this.dataset.pattern, this.dataset.candles)" data-candles="${rawDataJson}" data-pattern="${patternLabel}">`;

                l5_data.forEach((c, i) => {
                    const isGreen = c.c > c.o;
                    const color = isGreen ? '#089981' : (c.c < c.o ? '#F23645' : '#787B86');
                    const xCenter = (i * (candleWidth + gap)) + (candleWidth / 2);

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

            // Textual pattern logic
            const pattern = stock.candlestick_pattern;
            let textHtml = '';
            if (pattern) {
                let textColor = "var(--text-dim)";
                if (pattern.includes("Bullish")) textColor = "var(--success)";
                else if (pattern.includes("Bearish")) textColor = "var(--danger)";

                textHtml = `<div class="pattern-text" style="color: ${textColor};" title="${pattern}">${pattern}</div>`;
            }

            // Populate Sparkline Column
            if (svgHtml) {
                sparklineHtml += svgHtml;
            } else {
                sparklineHtml += `<div style="font-size: 13px; color: var(--text-dim);">-</div>`;
            }
            sparklineHtml += `</div></td>`;

            // Populate Pattern Name Column
            if (textHtml) {
                patternNameHtml += textHtml;
            } else {
                patternNameHtml += `<div style="font-size: 13px; color: var(--text-dim);">-</div>`;
            }
            patternNameHtml += `</td>`;

            rowHtml += sparklineHtml + patternNameHtml;
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
                        <span class="text-danger font-bold">${stock.sl ? stock.sl.toFixed(1) : '-'}</span>
                        <span style="font-size: 11px; color: var(--danger); opacity: 0.8;">(${slDiffPct ? slDiffPct + '%' : '-'})</span>
                    </div>
                    <div class="tp-row" style="justify-content: flex-start; gap: 8px; margin-top: 2px;">
                        <span class="text-dim" style="width: 25px;">Tgt:</span>
            </td>
        `;

        // Add the new Trade button column here
        rowHtml += `
            <td>
                <button class="btn btn-primary" style="padding: 6px 12px; font-size: 11px; font-weight: 700;" onclick="openPaperTrade('${stock.isin}', '${stock.symbol}', ${stock.ltp}, '${currentTimeframe}')">
                    <i class="fas fa-plus-circle"></i> Trade
                </button>
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
    const profile = currentMode;
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

    document.getElementById('setting-fundamentals-enabled').checked = conf.fundamentals ? conf.fundamentals.enabled : false;

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

    conf.dma.enabled = document.getElementById('setting-dma-enabled').checked;
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
    const profile = currentMode;
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

    if (!conf.fundamentals) conf.fundamentals = {};
    conf.fundamentals.enabled = document.getElementById('setting-fundamentals-enabled').checked;

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

    saveConfigsToLocalStorage();

    // Sync settings with Backend Database for indicator engine
    const syncBtn = document.querySelector('#settings-view .btn-primary');
    const originalBtnHtml = syncBtn ? syncBtn.innerHTML : null;
    if (syncBtn) {
        syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving to DB...';
        syncBtn.disabled = true;
    }

    fetch('/api/settings/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            profile: profile,
            settings: conf
        })
    })
        .then(res => res.json())
        .then(data => {
            console.log("DB Settings Sync:", data.message);
            if (syncBtn) {
                syncBtn.innerHTML = '<i class="fas fa-check"></i> Applied Successfully';
                syncBtn.disabled = false;
                setTimeout(() => {
                    syncBtn.innerHTML = originalBtnHtml;
                    switchTab('dashboard');
                }, 1000);
            } else {
                switchTab('dashboard');
            }
        })
        .catch(err => {
            console.error("DB Settings Sync Error:", err);
            if (syncBtn) {
                syncBtn.innerHTML = originalBtnHtml;
                syncBtn.disabled = false;
            }
            alert("Settings saved locally, but failed to sync with Database. Indicators may use old periods.");
            switchTab('dashboard');
        });
}

function switchTab(tabId) {
    // Hide all main content views
    document.querySelectorAll('.main-content').forEach(el => el.classList.add('hidden'));

    // Show target view
    const target = document.getElementById(tabId + '-view');
    if (target) {
        target.classList.remove('hidden');
        activeTab = tabId;
    }

    // Update sidebar navigation active state
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navItem = document.getElementById('nav-' + tabId);
    if (navItem) {
        navItem.classList.add('active');
    }

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
    } else if (tabId === 'pro-screener') {
        renderProScreener();
    } else if (tabId === 'trades') {
        fetchActiveTrades();
    } else if (tabId === 'strategy-lab') {
        initStrategyLab();
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
                    let gapHtml = '';
                    if (stats.gaps && stats.gaps.length > 0) {
                        const gapList = stats.gaps.join(', ');
                        const total = stats.total_gap_count || stats.gaps.length;
                        gapHtml = `
                            <div class="text-danger" style="font-size: 11px; margin-top: 4px; display: flex; align-items: center; gap: 4px;">
                                <i class="fas fa-exclamation-triangle"></i> 
                                <span title="Missing dates: ${gapList}">${total} gaps found</span>
                            </div>
                        `;
                    }

                    tbody.innerHTML += `
                        <tr>
                            <td style="font-weight: 600;">${tf} ${gapHtml}</td>
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
    const mainContents = document.querySelectorAll('.main-content');
    sidebar.classList.toggle('collapsed');
    mainContents.forEach(el => el.classList.toggle('expanded'));
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

function syncHudVisibility() {
    const swingHud = document.getElementById('job-hud-swing');
    const intradayHud = document.getElementById('job-hud-intraday');

    if (currentMode === 'swing') {
        intradayHud.classList.add('hidden');
        if (HUD_STATES.swing.active) swingHud.classList.remove('hidden');
        else swingHud.classList.add('hidden');
    } else {
        swingHud.classList.add('hidden');
        if (HUD_STATES.intraday.active) intradayHud.classList.remove('hidden');
        else intradayHud.classList.add('hidden');
    }
}

function toggleHudExpand(mode) {
    const console = document.getElementById(`hud-console-${mode}`);
    HUD_STATES[mode].expanded = !HUD_STATES[mode].expanded;
    console.classList.toggle('hidden', !HUD_STATES[mode].expanded);
}

async function fetchMarketData() {
    const mode = currentMode;
    const btn = document.getElementById('fetch-data-btn');
    const hud = document.getElementById(`job-hud-${mode}`);
    const bar = document.getElementById(`hud-bar-${mode}`);
    const percent = document.getElementById(`hud-percent-${mode}`);
    const statusText = document.getElementById(`hud-status-${mode}`);
    const console = document.getElementById(`hud-console-${mode}`);

    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';
    btn.classList.add('btn-disabled');
    btn.disabled = true;

    HUD_STATES[mode].active = true;
    syncHudVisibility();
    console.innerHTML = '';
    statusText.innerText = `Fetching ${mode.toUpperCase()} Market Data...`;

    const evtSource = new EventSource(`/api/stream/fetch-data?mode=${mode}`);
    fetchEvtSource = evtSource;

    evtSource.onmessage = function (event) {
        if (event.data === "[DONE]") {
            evtSource.close();
            fetchEvtSource = null;
            bar.style.width = '100%';
            percent.innerText = '100%';
            statusText.innerText = 'Fetch Complete';

            setTimeout(() => {
                HUD_STATES[mode].active = false;
                syncHudVisibility();
                btn.innerHTML = originalHTML;
                btn.classList.remove('btn-disabled');
                btn.disabled = false;
                fetchSystemStatus();

                if (isAutoSyncEnabled && CONFIGS[mode] && CONFIGS[mode].auto.calc) {
                    refreshSignals();
                }
            }, 1500);
            return;
        }

        // Partial progress simulation (finding count in logs)
        const match = event.data.match(/(\d+)\/(\d+)/);
        if (match) {
            const current = parseInt(match[1]);
            const total = parseInt(match[2]);
            const p = Math.floor((current / total) * 100);
            bar.style.width = `${p}%`;
            percent.innerText = `${p}%`;
        }

        const logLine = document.createElement('div');
        logLine.innerText = event.data;
        if (event.data.includes("✅")) logLine.style.color = "var(--success)";
        else if (event.data.includes("ERROR:") || event.data.includes("WARNING:")) logLine.style.color = "var(--danger)";

        console.appendChild(logLine);
        console.scrollTop = console.scrollHeight;
    };

    evtSource.onerror = function () {
        evtSource.close();
        fetchEvtSource = null;
        HUD_STATES[mode].active = false;
        syncHudVisibility();
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    };
}

async function stopFetch() {
    try {
        await fetch(`/api/stop-fetch?mode=${currentMode}`, { method: 'POST' });
        if (fetchEvtSource) fetchEvtSource.close();
        fetchEvtSource = null;
        HUD_STATES[currentMode].active = false;
        syncHudVisibility();

        const btn = document.getElementById('fetch-data-btn');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-download"></i> Fetch Market Data';
    } catch (e) {
        console.error("Stop fetch failed:", e);
    }
}

async function refreshSignals() {
    const mode = currentMode;
    const btnIcon = document.getElementById('refresh-icon');
    const hud = document.getElementById(`job-hud-${mode}`);
    const bar = document.getElementById(`hud-bar-${mode}`);
    const percent = document.getElementById(`hud-percent-${mode}`);
    const statusText = document.getElementById(`hud-status-${mode}`);
    const console = document.getElementById(`hud-console-${mode}`);

    HUD_STATES[mode].active = true;
    syncHudVisibility();
    btnIcon.classList.add('fa-spin');
    console.innerHTML = '<div>Starting indicator calculation...</div>';

    const timeframes = MODES[mode].timeframes;
    let currentStep = 0;
    const totalSteps = timeframes.length;

    try {
        const conf = CONFIGS[mode];
        const useFundamentals = conf.fundamentals ? conf.fundamentals.enabled : false;

        // Start Stage-based progress
        statusText.innerText = `Calculating: ${timeframes[0]}...`;

        // Since the backend doesn't stream progress yet, we simulate the bar movement per stage
        const calcFetch = fetch(`/api/calculate?mode=${mode}&fundamentals=${useFundamentals}`, { method: 'POST' });

        // Fake Smooth Bar
        let p = 5;
        const interval = setInterval(() => {
            p += Math.random() * 2;
            if (p > 95) clearInterval(interval);
            bar.style.width = `${Math.floor(p)}%`;
            percent.innerText = `${Math.floor(p)}%`;

            // Periodically update console with "Working" logs
            if (Math.random() > 0.8) {
                const log = document.createElement('div');
                log.innerText = `Processing batch for ${mode}...`;
                console.appendChild(log);
                console.scrollTop = console.scrollHeight;
            }
        }, 500);

        await calcFetch;
        clearInterval(interval);

        bar.style.width = '100%';
        percent.innerText = '100%';
        statusText.innerText = 'Calculations Ready';
        console.innerHTML += '<div style="color:var(--success)">✅ Calculations completed successfully.</div>';

        await fetchAndRenderSignals(true);
        fetchSystemStatus();

    } catch (e) {
        console.error("Calculation failed:", e);
        statusText.innerText = 'Calculation Failed';
        console.innerHTML += `<div style="color:var(--danger)">❌ Error: ${e.message}</div>`;
    } finally {
        setTimeout(() => {
            HUD_STATES[mode].active = false;
            syncHudVisibility();
            btnIcon.classList.remove('fa-spin');
        }, 2000);
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
                <td style="padding: 12px;">${d.avg_entry.toFixed(2)}</td>
                <td style="padding: 12px; color: var(--text-dim);">${trancheDisplay}</td>
                <td style="padding: 12px;">${d.exit_price.toFixed(2)}</td>
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

function setupDualSlider(minId, maxId, rangeId, labelId, minLimit, maxLimit, step, unit, onUpdate) {
    const minInput = document.getElementById(minId);
    const maxInput = document.getElementById(maxId);
    const rangeTrack = document.getElementById(rangeId);
    const label = document.getElementById(labelId);

    if (!minInput || !maxInput || !rangeTrack || !label) return;

    function update() {
        let minVal = parseFloat(minInput.value);
        let maxVal = parseFloat(maxInput.value);

        if (minVal > maxVal) {
            if (this === minInput) { minInput.value = maxVal; minVal = maxVal; }
            else { maxInput.value = minVal; maxVal = minVal; }
        }

        const rangeWidth = maxLimit - minLimit;
        rangeTrack.style.left = ((minVal - minLimit) / rangeWidth * 100) + '%';
        rangeTrack.style.width = ((maxVal - minVal) / rangeWidth * 100) + '%';
        label.innerText = `${minVal}${unit} - ${maxVal}${unit}`;

        if (onUpdate) onUpdate();
    }

    minInput.oninput = update;
    maxInput.oninput = update;
    update();
}

function setupRSISlider() {
    setupDualSlider('filter-rsi-min', 'filter-rsi-max', 'rsi-slider-range', 'rsi-range-label', 0, 100, 1, '', renderSignals);
}

function setupScreenerSliders() {
    setupDualSlider('screener-target-min', 'screener-target-max', 'screener-target-range', 'screener-target-label', 0, 20, 0.5, '%', applyScreenerFilters);
    setupDualSlider('screener-sl-min', 'screener-sl-max', 'screener-sl-range', 'screener-sl-label', 0, 10, 0.2, '%', applyScreenerFilters);
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
            // Default these specific advanced columns to hidden
            if (['Strategy', 'Trade Plan', 'Pattern Name', 'Industry', 'IndustryNew'].includes(text)) return false;

            // PE/ROE are strictly for Swing - hide/prevent them in Intraday view entirely
            if (currentMode === 'intraday' && (text === 'PE' || text === 'ROE')) return false;

            return true;
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

        // Strictly exclude PE/ROE from Intraday toggle options
        if (currentMode === 'intraday' && (headerText === 'PE' || headerText === 'ROE')) return;

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

let lastSectorData = [];

async function updateSectorSentiment() {
    const apiTf = TF_MAP[currentTimeframe] || '1d';
    const container = document.getElementById('sector-sentiment-container');
    if (!container) return;

    try {
        const response = await fetch(`/api/sector/sentiment?mode=${currentMode}&timeframe=${apiTf}`);
        const result = await response.json();

        if (result.status === 'success' && result.data.length > 0) {
            lastSectorData = result.data;
            renderSectorSentimentUI();
        } else {
            container.classList.add('hidden');
        }
    } catch (e) {
        console.error("Sector sentiment fetch failed:", e);
        container.classList.add('hidden');
    }
}

function renderSectorSentimentUI() {
    const container = document.getElementById('sector-sentiment-container');
    if (!container || lastSectorData.length === 0) return;

    container.classList.remove('hidden');
    container.classList.toggle('collapsed', isSectorBarCollapsed);

    let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; cursor: pointer;" onclick="toggleSectorCollapse()">
            <div style="font-size: 11px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-layer-group"></i> Industry Group Sentiment
            </div>
            <div style="display: flex; gap: 8px;" onclick="event.stopPropagation()">
                ${activeSectorFilter !== 'all' ? `<button onclick="setSectorFilter('all', true)" class="hud-btn" style="width: auto; padding: 0 10px; font-size: 10px; height: 24px; color: var(--amber);">Clear Filter</button>` : ''}
                <button onclick="toggleSectorCollapse()" class="hud-btn" style="width: 24px; height: 24px;" title="${isSectorBarCollapsed ? 'Expand' : 'Collapse'}">
                    <i class="fas ${isSectorBarCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}"></i>
                </button>
            </div>
        </div>
        <div class="sentiment-grid" style="display: flex; gap: 10px; flex-wrap: wrap;">
    `;

    lastSectorData.forEach(item => {
        const isSelected = activeSectorFilter === item.group;
        const color = item.score >= 60 ? 'var(--success)' : (item.score <= 40 ? 'var(--danger)' : 'var(--amber)');
        const icon = item.score >= 60 ? 'fa-arrow-trend-up' : (item.score <= 40 ? 'fa-arrow-trend-down' : 'fa-minus');

        html += `
            <div class="sector-sentiment-card ${isSelected ? 'active-sector' : ''}" 
                 style="border-left: 3px solid ${color};" 
                 onclick="setSectorFilter('${item.group}')"
                 title="${item.buy_count} Buy / ${item.sell_count} Sell out of ${item.total} total stocks">
                <div style="font-size: 11px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;">${item.group}</div>
                <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                    <span style="font-size: 14px; font-weight: 800; color: ${color};">${item.score}%</span>
                    <i class="fas ${icon}" style="font-size: 10px; color: ${color}; opacity: 0.8;"></i>
                </div>
            </div>
        `;
    });

    html += `</div>`;
    container.innerHTML = html;
}

function toggleSectorCollapse() {
    isSectorBarCollapsed = !isSectorBarCollapsed;
    const container = document.getElementById('sector-sentiment-container');
    if (container) {
        container.classList.toggle('collapsed', isSectorBarCollapsed);
        // Update the arrow icon immediately
        const icon = container.querySelector('.fa-chevron-up, .fa-chevron-down');
        if (icon) {
            icon.className = `fas ${isSectorBarCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}`;
        }
    }
}

function setSectorFilter(sectorName, clearDropdown = false) {
    if (activeSectorFilter === sectorName) {
        activeSectorFilter = 'all';
    } else {
        activeSectorFilter = sectorName;
    }
    renderSectorSentimentUI();
    renderSignals();
    if (activeSectorFilter !== 'all' && !clearDropdown) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
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

// Modal State for Multi-View
let modalTfState = {
    isin: null,
    symbol: null,
    pattern: '',
    activeTfs: [], // Array of strings e.g. ["5m", "15m"]
    isSplit: false
};

async function showCandlesPopup(isin, symbol, patternName = '', fallbackCandlesJson = '', requestedTf = null) {
    // Reset or Initialize State if it's a new stock
    if (modalTfState.isin !== isin) {
        modalTfState.isin = isin;
        modalTfState.symbol = symbol;
        modalTfState.pattern = patternName;
        // Default to current timeframe or Daily
        const initialTf = requestedTf || currentTimeframe || "Daily";
        modalTfState.activeTfs = [initialTf];
        modalTfState.isSplit = false;
    } else if (requestedTf && !modalTfState.isSplit) {
        // Regular mode: replace current TF
        modalTfState.activeTfs = [requestedTf];
    }

    const allTfs = ["5m", "15m", "30m", "60m", "Daily", "Weekly", "Monthly"];

    // Create/Reuse Modal
    let modal = document.getElementById('candle-zoom-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'candle-zoom-modal';
        modal.className = 'modal-overlay';
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
        document.body.appendChild(modal);
    }

    // Build Modal UI
    modal.innerHTML = `
        <div style="background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: 16px; padding: 24px; width: 1200px; max-width: 98vw; height: 90vh; box-shadow: 0 20px 60px rgba(0,0,0,0.6); position: relative; display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; flex-shrink: 0;">
                <div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <h3 style="margin: 0; font-size: 22px; font-weight: 700;">${symbol}</h3>
                        <div id="modal-split-toggle" onclick="toggleModalSplitMode()" title="Split View (Max 4)" style="cursor: pointer; padding: 6px 10px; border-radius: 8px; background: ${modalTfState.isSplit ? 'var(--primary)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${modalTfState.isSplit ? 'var(--primary)' : 'var(--border-color)'}; color: ${modalTfState.isSplit ? '#fff' : 'var(--text-dim)'}; transition: all 0.2s;">
                            <i class="fas fa-th-large"></i> Split View
                        </div>
                    </div>
                    ${patternName ? `<div style="margin-top: 6px; font-size: 13px; color: var(--text-dim);"><span style="color:var(--amber)">Condition:</span> ${patternName}</div>` : ''}
                    <div style="display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap;" id="modal-tf-buttons">
                        ${allTfs.map(tf => {
        const isActive = modalTfState.activeTfs.includes(tf);
        return `<button onclick="handleModalTfClick('${tf}')" 
                                class="tf-btn ${isActive ? 'active' : ''}"
                                style="font-size: 11px; padding: 4px 10px; min-width: 50px;">${tf}</button>`;
    }).join('')}
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 16px;">
                    <div id="modal-indicator-toggles" style="display: flex; gap: 10px; font-size: 10px; color: var(--text-dim); background: rgba(0,0,0,0.2); padding: 4px 12px; border-radius: 20px; border: 1px solid var(--border-color);">
                        <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;"><input type="checkbox" id="m-toggle-ema" checked> EMA</label>
                        <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;"><input type="checkbox" id="m-toggle-st" checked> SuperTrend</label>
                        <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;"><input type="checkbox" id="m-toggle-rsi" checked> RSI</label>
                    </div>
                    <button onclick="document.getElementById('candle-zoom-modal').style.display='none'" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); color: var(--text-dim); cursor: pointer; font-size: 20px; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">&times;</button>
                </div>
            </div>
            
            <div id="modal-charts-grid" style="flex: 1; overflow: hidden; display: grid; gap: 16px; min-height: 0;">
                <!-- Charts will be injected here -->
            </div>
        </div>
    `;
    modal.style.display = 'flex';

    // Hook up indicator toggles
    ['m-toggle-ema', 'm-toggle-st', 'm-toggle-rsi'].forEach(id => {
        document.getElementById(id).onchange = () => refreshModalGrid();
    });

    refreshModalGrid();
}

/** Toggles between single and multi-view */
function toggleModalSplitMode() {
    modalTfState.isSplit = !modalTfState.isSplit;
    if (!modalTfState.isSplit && modalTfState.activeTfs.length > 1) {
        // Reverting to single: keep only first TF
        modalTfState.activeTfs = [modalTfState.activeTfs[0]];
    }
    showCandlesPopup(modalTfState.isin, modalTfState.symbol, modalTfState.pattern);
}

/** Handles timeframe button click in modal */
function handleModalTfClick(tf) {
    if (modalTfState.isSplit) {
        if (modalTfState.activeTfs.includes(tf)) {
            // Don't allow removing last TF
            if (modalTfState.activeTfs.length > 1) {
                modalTfState.activeTfs = modalTfState.activeTfs.filter(t => t !== tf);
            }
        } else if (modalTfState.activeTfs.length < 4) {
            modalTfState.activeTfs.push(tf);
        }
    } else {
        modalTfState.activeTfs = [tf];
    }
    showCandlesPopup(modalTfState.isin, modalTfState.symbol, modalTfState.pattern);
}

/** Renders the grid based on activeTfs */
async function refreshModalGrid() {
    const grid = document.getElementById('modal-charts-grid');
    if (!grid) return;

    const tfs = modalTfState.activeTfs;
    const count = tfs.length;

    // Apply Grid Layout
    if (count === 1) grid.style.gridTemplateColumns = '1fr';
    else if (count === 2) grid.style.gridTemplateColumns = '1fr 1fr';
    else grid.style.gridTemplateColumns = '1fr 1fr';

    if (count > 2) grid.style.gridTemplateRows = '1fr 1fr';
    else grid.style.gridTemplateRows = '1fr';

    grid.innerHTML = tfs.map((tf, i) => `
        <div id="slot-${i}" style="border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; display: flex; flex-direction: column; background: rgba(0,0,0,0.15); overflow: hidden; position: relative;">
            <div style="padding: 6px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 11px; font-weight: 700; color: var(--primary); background: rgba(14, 165, 233, 0.05); display: flex; justify-content: space-between;">
                <span>${tf}</span>
                <span id="slot-legend-${i}" style="font-weight: 400; color: var(--text-dim); display: flex; gap: 10px;"></span>
            </div>
            <div id="slot-chart-${i}" style="flex: 1; min-height: 0;"></div>
        </div>
    `).join('');

    const chartControls = {
        ema: document.getElementById('m-toggle-ema').checked,
        st: document.getElementById('m-toggle-st').checked,
        rsi: document.getElementById('m-toggle-rsi').checked,
        vol: true, dma: true, bars: parseInt(CONFIGS[currentMode].chart?.bars || 30)
    };

    // Orchestrate data fetching and rendering
    const chartRenderers = [];

    const promises = tfs.map(async (tf, i) => {
        const slotChart = document.getElementById(`slot-chart-${i}`);
        const slotLegend = document.getElementById(`slot-legend-${i}`);
        slotChart.innerHTML = '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-dim); font-size:12px;"><i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i> Loading ${tf}...</div>';

        const apiTf = TF_MAP[tf] || '1d';
        const cacheKey = `${modalTfState.isin}_${tf}_${chartControls.bars}`;
        let chartData = fullChartCache[cacheKey];

        if (!chartData) {
            try {
                const res = await fetch(`/api/chart/details?isin=${modalTfState.isin}&timeframe=${apiTf}&profile=${currentMode}&bars=${chartControls.bars}`);
                const result = await res.json();
                if (result.status === 'success') {
                    chartData = result.data;
                    fullChartCache[cacheKey] = chartData;
                }
            } catch (err) { console.error(`Fetch failed for ${tf}`, err); }
        }

        if (chartData) {
            const renderer = renderEnrichedChart(chartData, modalTfState.symbol, chartControls, tf, {
                container: slotChart,
                legend: slotLegend,
                onMouseMove: (timestamp) => {
                    // BROADCAST to other charts
                    chartRenderers.forEach(r => r && r.syncCrosshair && r.syncCrosshair(timestamp));
                },
                onMouseLeave: () => {
                    chartRenderers.forEach(r => r && r.clearCrosshair && r.clearCrosshair());
                }
            });
            chartRenderers[i] = renderer;
        } else {
            slotChart.innerHTML = `<div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--danger); font-size:12px;">Data Error</div>`;
        }
    });

    await Promise.all(promises);
}

function renderEnrichedChart(chartInput, symbol, opts, tfDisplay, overrides = {}) {
    const container = overrides.container || document.getElementById('zoom-chart-content');
    const legend = overrides.legend || document.getElementById('zoom-chart-legend');
    if (!container || !legend) return null;

    const candles = Array.isArray(chartInput) ? chartInput : (chartInput.candles || []);
    const vpvr = Array.isArray(chartInput) ? null : (chartInput.vpvr || null);

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
    const svgWidth = container.clientWidth || 950;
    const rsiKey = Object.keys(candles[0] || {}).find(k => k.startsWith('RSI_'));
    const showRSI = opts.rsi && rsiKey;

    const mainChartHeight = 400;
    const rsiHeight = showRSI ? 100 : 0;
    const svgHeight = mainChartHeight + rsiHeight;
    const chartPaddingRight = 70;
    const chartAreaWidth = svgWidth - chartPaddingRight;
    const padTop = 30;
    const padBottom = 35; // Space for volume bars within main chart
    const usableHeight = mainChartHeight - padTop - padBottom;

    const candleCount = candles.length;
    const barWidth = (chartAreaWidth / candleCount) * 0.75;
    const gap = (chartAreaWidth / candleCount) * 0.25;

    let svg = `<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" style="background: #0d1117; border-radius: 8px; user-select: none;">`;

    // 2.5 Render VPVR (Horizontal Volume)
    if (opts.vpvr && vpvr && vpvr.length > 0) {
        const maxVpvrVol = Math.max(...vpvr.map(v => v.volume)) || 1;
        const maxBarWidth = chartAreaWidth * 0.3; // Max 30% width
        const binHeight = usableHeight / vpvr.length;

        vpvr.forEach((v, i) => {
            const barW = (v.volume / maxVpvrVol) * maxBarWidth;
            const y = padTop + usableHeight - ((i + 1) * binHeight);
            svg += `<rect x="0" y="${y}" width="${barW}" height="${binHeight - 1}" fill="rgba(14, 165, 233, 0.15)" stroke="rgba(14, 165, 233, 0.3)" stroke-width="0.5" />`;
        });
    }

    // 3. Logic for Day Boundaries
    const isIntraday = ["5m", "15m", "30m", "60m"].includes(tfDisplay);

    if (opts.dayLines && isIntraday) {
        candles.forEach((c, i) => {
            if (i === 0) return;
            const prevDate = candles[i - 1].t.split(' ')[0];
            const currDate = c.t.split(' ')[0];
            if (prevDate !== currDate) {
                const xLine = (i * (barWidth + gap)) + 5 - (gap / 2);
                svg += `<line x1="${xLine}" y1="${padTop}" x2="${xLine}" y2="${padTop + usableHeight}" stroke="rgb(255, 255, 255)" stroke-width="1" stroke-dasharray="4 4" />`;
                svg += `<text x="${xLine + 4}" y="${padTop + 12}" fill="rgba(255,255,255,0.6)" font-size="9" font-weight="600">${currDate.split('-').slice(1).join('/')}</text>`;
            }
        });
    }

    // 4. Grid Lines & Price Labels
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
        const yLine = padTop + (usableHeight / steps) * i;
        const priceVal = maxH - (priceRange / steps) * i;
        svg += `<line x1="0" y1="${yLine}" x2="${chartAreaWidth}" y2="${yLine}" stroke="rgba(255,255,255,0.05)" stroke-width="1" />`;
        svg += `<text x="${chartAreaWidth + 10}" y="${yLine + 4}" fill="var(--text-dim)" font-size="11" font-family="sans-serif">${priceVal.toFixed(2)}</text>`;
    }

    // 5. Indicators
    // EMA Lines
    const emaKeys = Object.keys(candles[0] || {}).filter(k => k.startsWith('EMA_'));
    const sortedEmaKeys = [...emaKeys].sort((a, b) => parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]));

    if (opts.ema) {
        const colors = ['#2962FF', '#FF9800', '#E91E63'];
        sortedEmaKeys.forEach((key, idx) => {
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

        // EMA Crossovers
        if (opts.emaMarkers && sortedEmaKeys.length >= 2 && isIntraday) {
            const fastKey = sortedEmaKeys[0];
            const slowKey = sortedEmaKeys[1];
            candles.forEach((c, i) => {
                if (i === 0) return;
                const prevF = candles[i - 1][fastKey];
                const prevS = candles[i - 1][slowKey];
                const currF = c[fastKey];
                const currS = c[slowKey];

                if (prevF && prevS && currF && currS) {
                    const x = (i * (barWidth + gap)) + (barWidth / 2) + 5;
                    const y = padTop + usableHeight - ((currF - minL) / priceRange) * usableHeight;

                    if (prevF <= prevS && currF > currS) {
                        // Bullish Cross
                        svg += `<path d="M ${x - 5} ${y + 12} L ${x + 5} ${y + 12} L ${x} ${y + 2} Z" fill="var(--success)" opacity="0.9" />`;
                    } else if (prevF >= prevS && currF < currS) {
                        // Bearish Cross
                        svg += `<path d="M ${x - 5} ${y - 12} L ${x + 5} ${y - 12} L ${x} ${y - 2} Z" fill="var(--danger)" opacity="0.9" />`;
                    }
                }
            });
        }
    }

    // Supertrend (Dynamic Flip)
    if (opts.st) {
        for (let i = 1; i < candles.length; i++) {
            const p = candles[i - 1];
            const c = candles[i];
            if (p.ST_value && c.ST_value) {
                const x1 = ((i - 1) * (barWidth + gap)) + (barWidth / 2) + 5;
                const y1 = padTop + usableHeight - ((p.ST_value - minL) / priceRange) * usableHeight;
                const x2 = (i * (barWidth + gap)) + (barWidth / 2) + 5;
                const y2 = padTop + usableHeight - ((c.ST_value - minL) / priceRange) * usableHeight;

                const color = c.ST_dir === 1 ? '#10b981' : '#ef4444';
                svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2.5" stroke-dasharray="4 2" />`;
            }
        }
        const stConfig = CONFIGS[currentMode].st;
        legend.innerHTML += `<div style="display:flex; align-items:center; gap:6px;"><div style="width:10px; height:2px; background:#10b981"></div>Supertrend (${stConfig.period}, ${stConfig.mult})</div>`;
    }

    // DMA References (Horizontal Lines)
    if (opts.dma) {
        const dmaKeys = Object.keys(candles[0] || {}).filter(k => k.startsWith('DMA_'));
        dmaKeys.forEach((key) => {
            const val = candles[0][key];
            if (val && val >= minL && val <= maxH) {
                const y = padTop + usableHeight - ((val - minL) / priceRange) * usableHeight;
                svg += `<line x1="0" y1="${y}" x2="${chartAreaWidth}" y2="${y}" stroke="rgba(168, 85, 247, 0.4)" stroke-width="1" stroke-dasharray="8 4" />`;
                svg += `<text x="5" y="${y - 4}" fill="rgba(168, 85, 247, 0.8)" font-size="9">${key}</text>`;
            }
        });
    }

    // 6. Volume Bars (Background)
    if (opts.vol && maxV > 0) {
        candles.forEach((c, i) => {
            const vHeight = (c.v / maxV) * (usableHeight * 0.2);
            const x = (i * (barWidth + gap)) + 5;
            const y = mainChartHeight - padBottom - vHeight;
            const color = c.c >= c.o ? 'rgba(8, 153, 129, 0.12)' : 'rgba(242, 54, 69, 0.12)';
            svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${vHeight}" fill="${color}" />`;
        });
    }

    // 7. Draw Candles
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

    // RSI Subplot
    if (showRSI) {
        const rsiTop = mainChartHeight;
        const rsiUsable = rsiHeight - 15;

        // Separator line
        svg += `<line x1="0" y1="${rsiTop}" x2="${svgWidth}" y2="${rsiTop}" stroke="rgba(255,255,255,0.2)" stroke-width="1" />`;

        // RSI Bounds (30, 70)
        const y70 = rsiTop + rsiUsable - ((70 / 100) * rsiUsable);
        const y30 = rsiTop + rsiUsable - ((30 / 100) * rsiUsable);

        svg += `<rect x="0" y="${y70}" width="${chartAreaWidth}" height="${y30 - y70}" fill="rgba(168, 85, 247, 0.05)" />`;
        svg += `<line x1="0" y1="${y70}" x2="${chartAreaWidth}" y2="${y70}" stroke="rgba(168, 85, 247, 0.3)" stroke-width="1" stroke-dasharray="4 4" />`;
        svg += `<line x1="0" y1="${y30}" x2="${chartAreaWidth}" y2="${y30}" stroke="rgba(168, 85, 247, 0.3)" stroke-width="1" stroke-dasharray="4 4" />`;

        svg += `<text x="${chartAreaWidth + 10}" y="${y70 + 4}" fill="var(--text-dim)" font-size="9">70</text>`;
        svg += `<text x="${chartAreaWidth + 10}" y="${y30 + 4}" fill="var(--text-dim)" font-size="9">30</text>`;

        // RSI Line
        let rsiPoints = "";
        candles.forEach((c, i) => {
            const val = c[rsiKey];
            if (val) {
                const x = (i * (barWidth + gap)) + (barWidth / 2) + 5;
                const y = rsiTop + rsiUsable - ((val / 100) * rsiUsable);
                rsiPoints += `${x},${y} `;
            }
        });
        svg += `<polyline points="${rsiPoints}" fill="none" stroke="#A855F7" stroke-width="1.5" />`;
        legend.innerHTML += `<div style="display:flex; align-items:center; gap:6px;"><div style="width:10px; height:2px; background:#A855F7"></div>${rsiKey}</div>`;
    }

    // 8. Crosshair & Dynamic Labels
    svg += `<line id="ch-x" x1="0" y1="0" x2="0" y2="${svgHeight}" stroke="rgba(255,255,255,0.4)" stroke-dasharray="2 2" style="display:none; pointer-events:none;"/>`;
    svg += `<line id="ch-y" x1="0" y1="0" x2="${svgWidth}" y2="0" stroke="rgba(255,255,255,0.4)" stroke-dasharray="2 2" style="display:none; pointer-events:none;"/>`;
    svg += `<line id="ch-y-rsi" x1="0" y1="0" x2="${svgWidth}" y2="0" stroke="rgba(168,85,247,0.4)" stroke-dasharray="2 2" style="display:none; pointer-events:none;"/>`;

    svg += `<rect id="ch-y-lbl-bg" x="${chartAreaWidth}" y="0" width="70" height="20" fill="var(--primary)" rx="4" style="display:none; pointer-events:none;"/>`;
    svg += `<text id="ch-y-lbl-txt" x="${chartAreaWidth + 5}" y="0" fill="white" font-size="10" font-weight="600" style="display:none; pointer-events:none;"></text>`;

    svg += `<rect id="ch-x-lbl-bg" x="0" y="${svgHeight - 20}" width="120" height="20" fill="var(--sidebar-bg)" rx="4" style="display:none; pointer-events:none;"/>`;
    svg += `<text id="ch-x-lbl-txt" x="0" y="${svgHeight - 7}" fill="white" font-size="10" text-anchor="middle" style="display:none; pointer-events:none;"></text>`;

    svg += `<text id="ch-ohlc" x="10" y="20" fill="var(--text-dim)" font-size="12" font-family="sans-serif"></text>`;

    svg += `</svg>`;
    container.innerHTML = svg;

    const svgEl = container.querySelector('svg');
    const chX = svgEl.querySelector('#ch-x');
    const chY = svgEl.querySelector('#ch-y');
    const chYRsi = svgEl.querySelector('#ch-y-rsi');
    const chYbg = svgEl.querySelector('#ch-y-lbl-bg');
    const chYtxt = svgEl.querySelector('#ch-y-lbl-txt');
    const chXbg = svgEl.querySelector('#ch-x-lbl-bg');
    const chXtxt = svgEl.querySelector('#ch-x-lbl-txt');
    const chOhlc = svgEl.querySelector('#ch-ohlc');

    const updateCrosshairInternal = (idx, yIn = null) => {
        if (idx < 0 || idx >= candles.length) {
            [chX, chY, chYRsi, chYbg, chYtxt, chXbg, chXtxt].forEach(el => el.style.display = 'none');
            return;
        }
        const c = candles[idx];
        const color = c.c >= c.o ? '#089981' : '#F23645';
        let ohlcText = `${c.t} | O:${c.o.toFixed(1)} H:${c.h.toFixed(1)} L:${c.l.toFixed(1)} C:<tspan fill="${color}">${c.c.toFixed(1)}</tspan>`;
        if (showRSI && c[rsiKey]) ohlcText += ` | RSI: <tspan fill="#A855F7">${c[rsiKey].toFixed(1)}</tspan>`;
        chOhlc.innerHTML = ohlcText;

        const snapX = (idx * (barWidth + gap)) + (barWidth / 2) + 5;
        chX.setAttribute('x1', snapX); chX.setAttribute('x2', snapX);
        [chX, chXbg, chXtxt].forEach(el => el.style.display = 'block');
        chXtxt.textContent = c.t;
        const txtWidth = chXtxt.getComputedTextLength() + 10;
        chXbg.setAttribute('width', txtWidth);
        chXbg.setAttribute('x', snapX - (txtWidth / 2));
        chXtxt.setAttribute('x', snapX);

        if (yIn !== null) {
            chY.setAttribute('y1', yIn); chY.setAttribute('y2', yIn);
            const priceAtY = maxH - ((yIn - padTop) / usableHeight) * priceRange;
            if (yIn >= padTop && yIn <= padTop + usableHeight) {
                chYbg.setAttribute('y', yIn - 10);
                chYtxt.setAttribute('y', yIn + 4);
                chYtxt.textContent = priceAtY.toFixed(2);
                [chYbg, chYtxt, chY].forEach(el => el.style.display = 'block');
                chYRsi.style.display = 'none';
            } else if (showRSI && yIn >= mainChartHeight && yIn <= mainChartHeight + rsiHeight - 15) {
                const rsiAtY = ((mainChartHeight + (rsiHeight - 15) - yIn) / (rsiHeight - 15)) * 100;
                chYbg.setAttribute('y', yIn - 10);
                chYtxt.setAttribute('y', yIn + 4);
                chYtxt.textContent = rsiAtY.toFixed(1);
                [chYbg, chYtxt, chYRsi].forEach(el => el.style.display = 'block');
                chY.style.display = 'none';
                chYRsi.setAttribute('y1', yIn); chYRsi.setAttribute('y2', yIn);
            } else {
                [chYbg, chYtxt, chY, chYRsi].forEach(el => el.style.display = 'none');
            }
        }
    };

    svgEl.onmousemove = (e) => {
        const r = svgEl.getBoundingClientRect();
        const xRaw = e.clientX - r.left;
        const yRaw = e.clientY - r.top;
        const idx = Math.floor((xRaw - 5) / (barWidth + gap));

        updateCrosshairInternal(idx, yRaw);

        if (overrides.onMouseMove && idx >= 0 && idx < candles.length) {
            overrides.onMouseMove(candles[idx].t);
        }
    };

    svgEl.onmouseleave = () => {
        [chX, chY, chYRsi, chYbg, chYtxt, chXbg, chXtxt].forEach(el => el.style.display = 'none');
        if (overrides.onMouseLeave) overrides.onMouseLeave();
    };

    return {
        syncCrosshair: (targetTimestamp) => {
            if (!targetTimestamp) return;
            const targetDate = new Date(targetTimestamp).getTime();

            // Find the candle in THIS timeframe that is closest to the hovered timestamp
            let closestIdx = -1;
            let minDiff = Infinity;

            for (let i = 0; i < candles.length; i++) {
                const candleDate = new Date(candles[i].t).getTime();
                const diff = Math.abs(candleDate - targetDate);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIdx = i;
                }
            }

            // Only update if it's within a reasonable "relevance" (e.g. same day for Swing vs Intraday)
            if (closestIdx !== -1) {
                updateCrosshairInternal(closestIdx, null);
            }
        },
        clearCrosshair: () => {
            [chX, chY, chYRsi, chYbg, chYtxt, chXbg, chXtxt].forEach(el => el.style.display = 'none');
            chOhlc.innerHTML = '';
        }
    };
}

// --- App Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("App Initialized. Defaulting to Swing Dashboard.");
    loadConfigsFromLocalStorage();
    setMode('swing');
    switchTab('dashboard');
    setupRSISlider(); // Initialize Dual RSI Slider
    setupScreenerSliders(); // Initialize Screener Sliders
    applyZoom(); // Apply initial zoom level
});

function saveConfigsToLocalStorage() {
    localStorage.setItem('stock_signal_configs', JSON.stringify(CONFIGS));
}

function loadConfigsFromLocalStorage() {
    const saved = localStorage.getItem('stock_signal_configs');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // Deep merge or simple assign? Simple assign for now to override defaults
            Object.assign(CONFIGS, parsed);
        } catch (e) {
            console.error("Failed to load saved configs:", e);
        }
    }
}

// --- Pro Screener & Paper Trading Logic ---

async function renderProScreener() {
    const tbody = document.getElementById('screener-tbody');
    const sentimentPlaceholder = document.getElementById('screener-sentiment-placeholder');
    if (!tbody || !sentimentPlaceholder) return;

    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:40px;"><i class="fas fa-spinner fa-spin"></i> Loading High-Conviction Alerts...</td></tr>';

    try {
        const response = await fetch(`/api/signals?mode=${currentMode}`);
        const result = await response.json();
        if (result.status !== 'success') throw new Error("API Failure");

        screenerMasterData = result.data.filter(s => Math.abs(s.confluence_rank || 0) >= 4);
        applyScreenerFilters();
    } catch (e) {
        console.error("Pro Screener Fetch Error:", e);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:40px; color:var(--danger);">Failed to load alerts.</td></tr>';
    }
}

function applyScreenerFilters() {
    const tbody = document.getElementById('screener-tbody');
    if (!tbody) return;

    const searchTerm = document.getElementById('screener-search').value.toLowerCase();
    const tfFilter = document.getElementById('screener-filter-tf').value;
    const dirFilter = document.getElementById('screener-filter-dir').value;
    const stratFilter = document.getElementById('screener-filter-strat').value;

    const targetMin = parseFloat(document.getElementById('screener-target-min').value);
    const targetMax = parseFloat(document.getElementById('screener-target-max').value);
    const slMin = parseFloat(document.getElementById('screener-sl-min').value);
    const slMax = parseFloat(document.getElementById('screener-sl-max').value);

    let filtered = screenerMasterData.filter(s => {
        // 1. Search filter
        const matchesSearch = s.symbol.toLowerCase().includes(searchTerm) || s.isin.toLowerCase().includes(searchTerm);
        if (!matchesSearch) return false;

        // 2. Timeframe filter
        if (tfFilter !== 'all' && s.timeframe !== tfFilter) return false;

        // 3. Direction filter
        if (dirFilter !== 'all') {
            const isBuy = (s.confluence_rank || 0) > 0;
            if (dirFilter === 'buy' && !isBuy) return false;
            if (dirFilter === 'sell' && isBuy) return false;
        }

        // 4. Strategy filter
        if (stratFilter !== 'all' && s.trade_strategy !== stratFilter) return false;

        // 5. Target/SL % filters
        const score = s.confluence_rank || 0;
        const price = s.ltp || s.close || 0;
        const targetVal = s.target || (score > 0 ? price * 1.05 : price * 0.95); // fallback if not in DB
        const slVal = s.sl || (score > 0 ? price * 0.97 : price * 1.03);

        const rewardPct = Math.abs((targetVal - price) / price) * 100;
        const riskPct = Math.abs((slVal - price) / price) * 100;

        if (rewardPct < targetMin || rewardPct > targetMax) return false;
        if (riskPct < slMin || riskPct > slMax) return false;

        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:40px; color:var(--text-dim);">No signals found matching your filters in ${currentMode} mode.</td></tr>`;
        return;
    }

    const getMetricsList = (s) => {
        let metrics = [];
        const score = s.confluence_rank || 0;
        const isBull = score > 0;

        metrics.push(`TOTAL CONVICTION: ${score > 0 ? '+' : ''}${score} / 5\n-------------------`);

        if (isBull) {
            metrics.push(s.ema_signal === 'BUY' ? "✓ EMA: Bullish Golden Crossover" : "✗ EMA: Neutral/Bearish");
            metrics.push(s.supertrend_dir === 'BUY' ? "✓ SUPERTREND: Bullish Support" : "✗ SUPERTREND: No Support");
            metrics.push(s.rsi > 50 ? `✓ RSI: ${s.rsi.toFixed(1)} (Strong Momentum)` : `✗ RSI: ${s.rsi.toFixed(1)} (Weak)`);
            metrics.push(s.ltp > (s.dma_data?.SMA_20 || 0) ? "✓ ANCHOR TREND: Above SMA 20" : "✗ ANCHOR TREND: Overextended/Below");
            metrics.push(s.volume_signal === 'BULL_SPIKE' ? "✓ VOLUME: Institutional Buy Surge" : "✗ VOLUME: Normal Activity");
        } else {
            metrics.push(s.ema_signal === 'SELL' ? "✓ EMA: Bearish Death Cross" : "✗ EMA: Neutral/Bullish");
            metrics.push(s.supertrend_dir === 'SELL' ? "✓ SUPERTREND: Bearish Resistance" : "✗ SUPERTREND: No Resistance");
            metrics.push(s.rsi < 50 ? `✓ RSI: ${s.rsi.toFixed(1)} (Selling Pressure)` : `✗ RSI: ${s.rsi.toFixed(1)} (Strong)`);
            metrics.push(s.ltp < (s.dma_data?.SMA_20 || 1000000) ? "✓ ANCHOR TREND: Below SMA 20" : "✗ ANCHOR TREND: Overbought/Above");
            metrics.push(s.volume_signal === 'BEAR_SPIKE' ? "✓ VOLUME: Institutional Sell Panic" : "✗ VOLUME: Normal Activity");
        }
        metrics.push("\nPLAN: Maintain strict SL and exit at T1. If trend continues, trail SL and hold for higher reward.");
        return metrics.join('\n');
    };

    let html = '';
    filtered.forEach(s => {
        const score = s.confluence_rank || 0;
        const isBullish = score > 0;
        const rankClass = score >= 4 ? 'rank-high' : (score <= -4 ? 'rank-low' : '');
        const price = s.ltp || s.close || 0;

        // Visual distinction for Swing vs Intraday
        const tf = s.timeframe || (currentMode === 'swing' ? '1d' : '5m');
        const isSwing = ['1d', '1w', '1mo'].includes(tf);
        const tfBadge = `<span class="badge ${isSwing ? 'bg-blue-trans' : 'bg-amber-trans'}" style="font-size:9px; padding: 2px 6px;">${isSwing ? 'SWING' : 'INTRADAY'} (${tf})</span>`;

        // Strategy derived from rank & RSI
        const strategy = s.trade_strategy || (Math.abs(score) === 5 ? "High Conviction Confluence" : "Trend Support");
        const stratBg = isBullish ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';
        const stratColor = isBullish ? 'var(--success)' : 'var(--danger)';
        const metricsTooltip = getMetricsList(s);

        const targetVal = s.target || (isBullish ? price * 1.05 : price * 0.95);
        const slVal = s.sl || (isBullish ? price * 0.97 : price * 1.03);

        const risk = Math.abs(price - slVal);
        const reward = Math.abs(targetVal - price);
        const rrRatio = risk > 0 ? (reward / risk).toFixed(1) : "3.0+";

        const targetPct = ((reward / price) * 100).toFixed(1);
        const slPct = ((risk / price) * 100).toFixed(1);

        const targets = `T1: ${targetVal.toFixed(2)}<br><span style="font-size:10px; opacity:0.7; font-weight:400;">(+${targetPct}%)</span>`;
        const sl = `${slVal.toFixed(2)}<br><span style="font-size:10px; opacity:0.7; font-weight:400;">(${slPct}%)</span>`;
        const accumulation = `Zone: ${price.toFixed(2)}`;

        html += `
            <tr>
                <td>
                    <div class="rank-badge ${rankClass}" style="margin-top: 2px;">${score}</div>
                    <div style="margin-top: 8px;">${tfBadge}</div>
                </td>
                <td>
                    <div style="font-weight:700;">${s.symbol}</div>
                    <div style="font-size:10px; color:var(--text-dim);">${s.isin}</div>
                </td>
                <td style="font-weight:700; color:var(--text-main);">
                    <div>${price.toLocaleString('en-IN')}</div>
                    <div style="font-size: 10px; color: var(--text-dim); font-weight: 400; margin-top: 4px;">
                        <i class="far fa-clock" style="font-size: 9px;"></i> ${s.timestamp || 'N/A'}
                    </div>
                </td>
                <td>
                    <span class="badge" title="${metricsTooltip}" style="background:${stratBg}; color:${stratColor}; border:1px solid ${stratColor}44; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: help;">
                        ${strategy} <i class="fas fa-info-circle" style="font-size: 9px; opacity: 0.7;"></i>
                    </span>
                    <div style="font-size: 10px; color: var(--text-dim); margin-top: 6px;">
                        Risk/Reward: <span style="color: var(--text-main); font-weight: 600;">1:${rrRatio}</span>
                    </div>
                </td>
                <td style="color:var(--amber); font-weight:600; font-size:11px;">${accumulation}</td>
                <td style="color:var(--success); font-weight:600; font-size:11px;">${targets}</td>
                <td style="color:var(--danger); font-weight:600; font-size:11px;">${sl}</td>
                <td>
                    <button class="btn btn-primary" style="padding:6px 14px; font-size:11px; background:var(--primary); box-shadow: 0 4px 12px rgba(2, 132, 199, 0.2);" 
                        onclick="openPaperTrade('${s.isin}', '${s.symbol}', ${price}, '${s.timeframe || (currentMode === 'swing' ? '1d' : '5m')}')">
                        <i class="fas fa-plus-circle"></i> Trade
                    </button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

async function openPaperTrade(isin, symbol, price, timeframe) {
    const qty = prompt(`Enter quantity for ${symbol} at ₹${price}:`, "100");
    if (!qty || isNaN(qty)) return;

    // Map timeframe string (e.g., 'Daily') to API code (e.g., '1d') if needed
    const apiTf = TF_MAP[timeframe] || timeframe || '1d';

    const payload = {
        isin: isin,
        symbol: symbol,
        mode: currentMode,
        timeframe: apiTf,
        entry_price: price,
        target: price * 1.05, // Standard fallback
        stop_loss: price * 0.97, // Standard fallback
        qty: parseInt(qty)
    };

    try {
        const res = await fetch('/api/trades/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.status === 'success') {
            alert(`Paper trade opened for ${symbol}! Check your Paper Trading tab.`);
        }
    } catch (e) {
        console.error("Failed to open trade", e);
        alert("Failed to open trade. Check console.");
    }
}

async function fetchActiveTrades() {
    const tbody = document.getElementById('active-trades-tbody');
    const totalPnlEl = document.getElementById('trades-total-pnl');
    if (!tbody) return;

    try {
        const res = await fetch('/api/trades/active');
        const result = await res.json();
        if (result.status === 'success') {
            const trades = result.data;
            if (trades.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:40px; color:var(--text-dim);">No active trades. Go to Pro Screener or Dashboard to commit a trade.</td></tr>`;
                totalPnlEl.innerText = '₹0.00';
                return;
            }

            let html = '';
            let totalPnl = 0;
            trades.forEach(t => {
                const ltp = t.ltp || t.entry_price;
                const pnl = (ltp - t.entry_price) * t.qty;
                const pnlPct = ((ltp - t.entry_price) / t.entry_price) * 100;
                const pnlColor = pnl >= 0 ? 'var(--success)' : 'var(--danger)';
                totalPnl += pnl;

                html += `
                    <tr>
                        <td><span class="badge" style="background:rgba(255,255,255,0.05);">${t.timeframe}</span></td>
                        <td><div style="font-weight:700;">${t.symbol}</div><div style="font-size:9px; color:var(--text-dim);">${t.isin}</div></td>
                        <td>₹${t.entry_price.toLocaleString('en-IN')}</td>
                        <td style="font-weight:700; color:var(--primary);">₹${ltp.toLocaleString('en-IN')}</td>
                        <td>${t.qty}</td>
                        <td style="color:${pnlColor}; font-weight:700;">₹${pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td style="color:${pnlColor}; font-weight:700;">${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</td>
                        <td>
                            <button class="btn btn-danger" style="padding:4px 10px; font-size:10px; background:rgba(239, 68, 68, 0.1); color:var(--danger); border:1px solid rgba(239, 68, 68, 0.2);" onclick="closeTrade(${t.id})">
                                <i class="fas fa-times"></i> Close
                            </button>
                        </td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
            totalPnlEl.innerText = `₹${totalPnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
            totalPnlEl.style.color = totalPnl >= 0 ? 'var(--success)' : 'var(--danger)';
        }
    } catch (e) {
        console.error("Failed to fetch trades", e);
    }
}

async function closeTrade(id) {
    if (!confirm("Are you sure you want to close this paper trade?")) return;
    try {
        const res = await fetch(`/api/trades/close/${id}`, { method: 'POST' });
        const result = await res.json();
        if (result.status === 'success') {
            fetchActiveTrades();
        }
    } catch (e) {
        console.error("Failed to close trade", e);
    }
}

// --- Strategy Lab Beta (DSL Query Engine) ---

const STRAT_ALIASES = {
    "Price": "LTP",
    "Last Price": "LTP",
    "CMP": "LTP",
    "LTP": "LTP",
    "Super Trend": "ST",
    "SuperTrend": "ST", // Common variant
    "ST": "ST",
    "Super Trend Value": "ST_V",
    "SuperTrendValue": "ST_V", // Common variant
    "ST_V": "ST_V",
    "STV": "ST_V",
    "RSI": "RSI",
    "Volume": "VOL",
    "VOL": "VOL",
    "Volume Ratio": "VOL_R",
    "VOL_R": "VOL_R",
    "Bullish Volume": "BULL_S",
    "BULL_S": "BULL_S",
    "Bearish Volume": "BEAR_S",
    "BEAR_S": "BEAR_S",
    "EMA Fast": "EMA_F",
    "EMA_F": "EMA_F",
    "EMA Slow": "EMA_S",
    "EMA_S": "EMA_S",
    "EMA Crossover": "EMA_C",
    "EMA_C": "EMA_C",
    "EMA Value": "EMA_V",
    "EMA_V": "EMA_V",
    "Market Cap": "market_cap",
    "PE Ratio": "pe",
    "PE": "pe",
    "PB Ratio": "pb",
    "PB": "pb",
    "ROE": "roe",
    "EPS": "eps",
    "OPM": "opm",
    "NPM": "npm",
    "Sector": "sector",
    "Industry": "industry",
    "Prev_High": "prev_high",
    "Prev_Low": "prev_low"
};

const STRAT_KEYWORDS = [
    ...Object.keys(STRAT_ALIASES),
    "AND", "OR", "NOT", "Timeframe =", "5m", "15m", "30m", "1h", "1d", "BUY", "SELL", "BULL_S", "BEAR_S", "EMA_F", "EMA_S", "ST_V", "ST"
];

function initStrategyLab() {
    renderSavedStrategies();
    setupStrategyAutoSuggest();
    updateStrategyLabOptions();
    updateStrategyExplainer();
}

let lastScanMatches = []; // Global storage for filtering

function toggleStrategyForm() {
    const container = document.getElementById('strategy-editor-container');
    const btn = document.getElementById('toggle-strat-form');
    const text = document.getElementById('toggle-strat-text');

    if (container.style.display === 'none') {
        container.style.display = 'grid';
        if (text) text.innerText = 'Collapse Form';
        btn.querySelector('i').className = 'fas fa-compress-alt';
    } else {
        container.style.display = 'none';
        if (text) text.innerText = 'Show Strategy Designer';
        btn.querySelector('i').className = 'fas fa-expand-alt';
    }
}

function filterStrategyResults() {
    const term = document.getElementById('strat-results-search').value.toLowerCase();
    if (!term) {
        renderScanResults(lastScanMatches);
        return;
    }
    const filtered = lastScanMatches.filter(m =>
        m.symbol.toLowerCase().includes(term) ||
        m.isin.toLowerCase().includes(term)
    );
    renderScanResults(filtered, true); // true = skip global update
}

function setupStrategyAutoSuggest() {
    const textareas = document.querySelectorAll('.strategy-textarea');
    const suggestList = document.getElementById('strat-suggestions');
    if (textareas.length === 0 || !suggestList) return;

    const handleInput = (e) => {
        const textarea = e.target;
        const value = textarea.value;
        const cursor = textarea.selectionStart;

        const before = value.substring(0, cursor);
        const words = before.split(/[\s\n\(\)]+/);
        const lastWord = words[words.length - 1];

        if (lastWord.length < 2) {
            suggestList.style.display = 'none';
            return;
        }

        const matches = STRAT_KEYWORDS.filter(k => k.toLowerCase().startsWith(lastWord.toLowerCase())).slice(0, 10);

        if (matches.length > 0) {
            suggestList.innerHTML = matches.map(m => `
                <div class="suggest-item" style="padding: 10px 16px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 14px; color: var(--text-main);" 
                    onclick="applyStratSuggestion('${m}', '${textarea.id}')">
                    ${m}
                </div>
            `).join('');

            // Position suggestions
            suggestList.style.display = 'block';
        } else {
            suggestList.style.display = 'none';
        }
    };

    textareas.forEach(ta => ta.addEventListener('input', handleInput));

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#strat-suggestions') && !e.target.closest('.strategy-textarea')) {
            suggestList.style.display = 'none';
        }
    });
}

function clearStrategyLab() {
    ['strat-name', 'strat-entry-query', 'strat-exit-query', 'strat-target-query', 'strat-sl-query', 'strat-accum-query'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = (id === 'strat-name') ? "" : "";
        if (el) el.value = "";
    });
    updateStrategyExplainer();
}

function loadSampleQuery(type) {
    const samples = {
        'bullish_dip': {
            name: "Institutional Dip Buyer",
            side: "BUY", tf: "15m", universe: "swing",
            entry: "(EMA_F > EMA_S AND RSI < 35)",
            target: "1.2% OR Price > [1h].High",
            sl: "[1h].ST_V - 0.2%",
            exit: "SuperTrend == 'SELL'",
            accum: "Add 50% on RSI breakout > 50"
        },
        'momentum_breakout': {
            name: "Hyper Momentum Scan",
            side: "BUY", tf: "5m", universe: "intraday",
            entry: "(Price > [1h].EMA_F AND VOL == 'BULL_S')",
            target: "2.5% OR Price > Prev_High",
            sl: "EMA_F - 0.5%",
            exit: "RSI > 80",
            accum: "Pyramid 25% if Vol > 3x"
        },
        'bearish_reversal': {
            name: "Bearish Rejection",
            side: "SELL", tf: "15m", universe: "swing",
            entry: "(RSI > 70 AND SuperTrend == 'SELL') AND (Timeframe = 1h AND SuperTrend == 'SELL')",
            target: "1.5% OR Price < [1h].Low",
            sl: "[1h].ST_V + 0.2%",
            exit: "RSI < 30",
            accum: ""
        },
        'fundamental_growth': {
            name: "Structural Growth (Daily)",
            side: "BUY", tf: "1d", universe: "swing",
            entry: "(ROE > 18 AND PE < 35) AND (VOL_R > 1.5 AND SuperTrend == 'BUY')",
            target: "5.0% OR Price > [1w].High",
            sl: "2.5% OR Price < [1w].Low",
            exit: "NPM < 10",
            accum: ""
        }
    };

    const s = samples[type];
    if (s) {
        const nameEl = document.getElementById('strat-name');
        if (nameEl) nameEl.value = s.name;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val || "";
        };

        setVal('strat-entry-query', s.entry);
        setVal('strat-target-query', s.target);
        setVal('strat-exit-query', s.exit);
        setVal('strat-sl-query', s.sl);
        setVal('strat-accum-query', s.accum);
        setVal('strat-side', s.side || "BUY");

        // Timeframe might need a moment to be valid if switching modes is involved, 
        // but here we just try to set it if it exists in the current mode's list.
        const tfEl = document.getElementById('strat-timeframe');
        if (tfEl) {
            // Check if the sample's TF is valid for current mode
            const options = Array.from(tfEl.options).map(o => o.value);
            if (options.includes(s.tf)) {
                tfEl.value = s.tf;
            } else {
                // Default to first available if sample TF doesn't match mode
                tfEl.selectedIndex = 0;
            }
        }

        updateStrategyExplainer();
    }
}

function generatePlainEnglish(translation) {
    const { query, primaryTf, side } = translation;
    let explanation = [];
    let lines = query.split('\n');
    let currentTf = primaryTf;

    // Basic Logic Explanation
    lines.forEach(line => {
        let l = line.toLowerCase();

        // 1. Timeframe Assignments (Strict parsing)
        const tfAssignment = line.match(/Timeframe\s*=\s*([a-z0-9]+)/i);
        if (tfAssignment) {
            currentTf = tfAssignment[1];
            explanation.push(`🔍 <b>Scanning</b> on the <b>${currentTf}</b> chart:`);
        }

        // 2. Logic Triggers
        if (l.includes('rsi <')) {
            const match = l.match(/rsi <\s*(\d+)/);
            const val = match ? match[1] : "??";
            explanation.push(`• Look for <b>Oversold</b> conditions (RSI below ${val})`);
        }
        if (l.includes('rsi >')) {
            const match = l.match(/rsi >\s*(\d+)/);
            const val = match ? match[1] : "??";
            explanation.push(`• Look for <b>Overbought</b> conditions (RSI above ${val})`);
        }
        if (l.includes('supertrend == \'buy\'')) {
            explanation.push(`• Ensure <b>SuperTrend</b> is in a <b>Bullish</b> phase.`);
        }
        if (l.includes('supertrend == \'sell\'')) {
            explanation.push(`• Ensure <b>SuperTrend</b> is in a <b>Bearish</b> phase.`);
        }
        if (l.includes('ema_f > ema_s')) {
            explanation.push(`• Confirm <b>Bullish EMA Crossover</b> (Fast EMA above Slow EMA).`);
        }
        if (l.includes('ema_f < ema_s')) {
            explanation.push(`• Confirm <b>Bearish EMA Crossover</b> (Fast EMA below Slow EMA).`);
        }
        if (l.includes('vol == \'bull_s\'')) {
            explanation.push(`• Look for <b>Bullish Volume Spike</b>.`);
        }
        if (l.includes('vol == \'bear_s\'')) {
            explanation.push(`• Look for <b>Bearish Volume Spike</b>.`);
        }
        if (l.includes('vol_r >')) {
            const match = l.match(/vol_r >\s*([0-9.]+)/);
            const val = match ? match[1] : "??";
            explanation.push(`• Confirm <b>Volume Ratio</b> is above ${val} (strong buying interest).`);
        }
        if (l.includes('pe <')) {
            const match = l.match(/pe <\s*(\d+)/);
            const val = match ? match[1] : "??";
            explanation.push(`• Consider stocks with a <b>P/E Ratio</b> below ${val} (value).`);
        }
        if (l.includes('roe >')) {
            const match = l.match(/roe >\s*(\d+)/);
            const val = match ? match[1] : "??";
            explanation.push(`• Prioritize companies with <b>Return on Equity</b> above ${val}% (profitability).`);
        }
    });

    return explanation;
}

function updateStrategyExplainer() {
    const entry = document.getElementById('strat-entry-query').value;
    const target = document.getElementById('strat-target-query').value;
    const sl = document.getElementById('strat-sl-query').value;
    const side = document.getElementById('strat-side').value;
    const tf = document.getElementById('strat-timeframe').value;

    const explainerEl = document.getElementById('strat-explainer-text');
    const mathEl = document.getElementById('strat-math-content');
    if (!explainerEl || !mathEl) return;

    if (!entry.trim()) {
        explainerEl.innerHTML = `<div style="opacity: 0.4; font-style: italic;">Provide entry condition to see blueprint...</div>`;
        return;
    }

    const entryTrans = translateUserQuery(entry, side, tf);
    const explanation = generatePlainEnglish(entryTrans);

    explainerEl.innerHTML = `
        <div style="font-weight: 800; color: ${side === 'BUY' ? 'var(--success)' : 'var(--danger)'}; margin-bottom: 15px; font-size: 15px;">
            PLAN: ${side} @ ${tf}
        </div>
        <div style="display: flex; flex-direction: column; gap: 12px;">
            <div style="padding: 8px; background: rgba(var(--success-rgb), 0.05); border-left: 3px solid var(--success);">
                <span style="font-size: 10px; font-weight: 800; opacity: 0.6; display: block; margin-bottom: 4px;">ENTRY LOGIC</span>
                ${explanation.join('<br>')}
            </div>
            ${target ? `<div style="padding: 8px; background: rgba(var(--amber-rgb), 0.05); border-left: 3px solid var(--amber);">
                <span style="font-size: 10px; font-weight: 800; opacity: 0.6; display: block; margin-bottom: 4px;">TARGET LOGIC</span>
                • ${target}
            </div>` : ''}
            ${sl ? `<div style="padding: 8px; background: rgba(var(--danger-rgb), 0.05); border-left: 3px solid var(--danger);">
                <span style="font-size: 10px; font-weight: 800; opacity: 0.6; display: block; margin-bottom: 4px;">STOP LOGIC</span>
                • ${sl}
            </div>` : ''}
        </div>
    `;

    // Math Simulation for Explainer
    const mathBase = 1000;
    let tPct = 0.5, sPct = 0.3;

    const tMatch = target.match(/(\d+\.?\d*)\s*%/);
    if (tMatch) tPct = parseFloat(tMatch[1]);

    const sMatch = sl.match(/(\d+\.?\d*)\s*%/);
    if (sMatch) sPct = parseFloat(sMatch[1]);

    const tVal = (side === 'BUY' ? mathBase * (1 + tPct / 100) : mathBase * (1 - tPct / 100));
    const sVal = (side === 'BUY' ? mathBase * (1 - sPct / 100) : mathBase * (1 + sPct / 100));

    mathEl.innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 5px;">
            <span style="opacity: 0.6; font-size: 11px;">SIMULATION (Base ₹${mathBase})</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <span style="font-size: 12px; color: var(--success);">Profit Target</span>
            <span style="font-weight:700; color: var(--success);">₹${tVal.toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px; color: var(--danger);">Hard Stop</span>
            <span style="font-weight:700; color: var(--danger);">₹${sVal.toFixed(2)}</span>
        </div>
    `;
}

function applyStratSuggestion(word, targetId = null) {
    let textarea;
    if (targetId) {
        textarea = document.getElementById(targetId);
    } else {
        textarea = document.activeElement;
        if (!textarea || !textarea.classList.contains('strategy-textarea')) { // Check if it's one of the strategy textareas
            textarea = document.getElementById('strat-entry-query'); // Fallback to entry query
        }
    }
    if (!textarea) return;

    const suggestList = document.getElementById('strat-suggestions');
    const value = textarea.value;
    const cursor = textarea.selectionStart;

    const before = value.substring(0, cursor);
    const words = before.split(/[\s\n\(\)]+/);
    const lastWord = words[words.length - 1];

    const newValue = value.substring(0, cursor - lastWord.length) + word + value.substring(cursor);
    textarea.value = newValue;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = cursor - lastWord.length + word.length;
    suggestList.style.display = 'none';
    updateStrategyExplainer();
}

function translateUserQuery(userQuery, side_override = null, tf_override = null) {
    let q = userQuery;

    // 1. Handle Assignments (Timeframe, Side/Action, Params)
    let defaultTf = tf_override || '15m'; // Default to 15m if not overridden
    let side = side_override || "BUY";

    const tfMatch = q.match(/Timeframe\s*=\s*(\w+)/i);
    if (tfMatch) {
        defaultTf = tfMatch[1].trim();
        q = q.replace(/Timeframe\s*=\s*\w+/i, "");
    }

    const sideMatch = q.match(/(Side|Action)\s*=\s*(\w+)/i);
    if (sideMatch) {
        side = sideMatch[2].trim().toUpperCase();
        q = q.replace(/(Side|Action)\s*=\s*\w+/i, "");
    } else if (!side_override) {
        // Only infer if not explicitly overridden by segmented field
        if (q.toLowerCase().includes('sell') || q.toLowerCase().includes('less')) {
            if (!q.toLowerCase().includes('buy')) side = "SELL";
        }
    }

    // Strip Target and StopLoss lines from logical evaluation
    q = q.replace(/Target\s*=\s*.*?(?:\n|$)/gi, "");
    q = q.replace(/StopLoss\s*=\s*.*?(?:\n|$)/gi, "");

    // 2. Map Aliases
    const sortedAliases = Object.keys(STRAT_ALIASES).sort((a, b) => b.length - a.length);

    let lines = q.split('\n');
    lines = lines.map(line => {
        let l = line.trim();
        if (!l) return "";

        sortedAliases.forEach(alias => {
            const regex = new RegExp(`(?<!\\[|\\.)\\b${alias}\\b`, 'gi');
            l = l.replace(regex, `[${defaultTf}].${STRAT_ALIASES[alias]}`);
        });

        sortedAliases.forEach(alias => {
            const regex = new RegExp(`\\.(${alias})\\b`, 'gi');
            l = l.replace(regex, `.${STRAT_ALIASES[alias]}`);
        });

        return l;
    });

    return {
        query: lines.join(" ").trim(),
        primaryTf: defaultTf,
        side: side
    };
}

async function saveCurrentStrategy() {
    const name = document.getElementById('strat-name').value || "Unnamed Strategy";
    const entry = document.getElementById('strat-entry-query').value;
    const target = document.getElementById('strat-target-query').value;
    const sl = document.getElementById('strat-sl-query').value;
    const exit = document.getElementById('strat-exit-query').value;
    const accum = document.getElementById('strat-accum-query').value;

    const side = document.getElementById('strat-side').value;
    const tf = document.getElementById('strat-timeframe').value;
    const universe = document.getElementById('strat-universe-mode').value;

    if (!entry) return alert("Please enter Entry Criteria.");

    // Store as JSON Blob in query_text
    const structuredData = {
        entry, target, sl, exit, accum, side, tf, universe, version: "3.0"
    };

    const payload = { name, query: JSON.stringify(structuredData) };

    try {
        const res = await fetch('/api/strategies/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast("Strategy Blueprint Saved.", "success");
            renderSavedStrategies();
        }
    } catch (e) {
        console.error(e);
        showToast("Storage Error.", "error");
    }
}

function loadSavedStrategyLogic(base64Data) {
    try {
        const raw = atob(base64Data);
        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            // Legacy support for plain text queries
            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.value = val || "";
            };
            setVal('strat-entry-query', raw);
            setVal('strat-exit-query', "");
            setVal('strat-target-query', "");
            setVal('strat-sl-query', "");
            setVal('strat-accum-query', "");
            setVal('strat-side', "BUY");
            setVal('strat-timeframe', "15m");
            showToast("Legacy blueprint loaded into Lab.", "info");
            updateStrategyExplainer();
            return;
        }

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val || "";
        };
        setVal('strat-entry-query', data.entry);
        setVal('strat-target-query', data.target);
        setVal('strat-sl-query', data.sl);
        setVal('strat-exit-query', data.exit);
        setVal('strat-accum-query', data.accum);

        const sideEl = document.getElementById('strat-side');
        if (sideEl) sideEl.value = data.side || "BUY";

        const tfEl = document.getElementById('strat-timeframe');
        if (tfEl) tfEl.value = data.tf || "15m";

        showToast("Blueprint Expanded.", "success");
        updateStrategyExplainer();
    } catch (e) {
        console.error("Load Error:", e);
        showToast("Failed to load blueprint.", "error");
    }
}

async function renderSavedStrategies() {
    const list = document.getElementById('strat-saved-list');
    if (!list) return;

    try {
        const res = await fetch('/api/strategies/list');
        const json = await res.json();
        const saved = json.data || [];

        if (saved.length === 0) {
            list.innerHTML = '<div style="font-size: 11px; color: var(--text-dim); text-align: center; padding: 10px;">No saved strategies.</div>';
            return;
        }

        list.innerHTML = saved.map(s => `
            <div class="saved-strat-item" onclick="loadSavedStrategyLogic('${btoa(s.query)}')" 
                style="background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border: 1px solid transparent; transition: all 0.2s; margin-bottom: 6px;">
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <div style="font-size: 13px; font-weight: 700; color: var(--text-main);">${s.name}</div>
                    <div style="font-size: 10px; opacity: 0.5;">Last Mod: ${new Date(s.updated_at).toLocaleDateString()}</div>
                </div>
                <button class="btn btn-icon" onclick="event.stopPropagation(); deleteStrategyFromServer(${s.id})" style="color: var(--danger); opacity: 0.5;"><i class="fas fa-trash"></i></button>
            </div>
        `).join('');
    } catch (e) {
        console.error("Failed to load strategies:", e);
    }
}

// This function is now redundant as loadSavedStrategyLogic handles structured data
// Keeping it for potential legacy calls, but it will likely break if called with structured data
function loadSavedStrategyLegacy(encodedQuery) {
    const query = atob(encodedQuery);
    document.getElementById('strat-entry-query').value = query;
    document.getElementById('strat-exit-query').value = "";
    document.getElementById('strat-side').value = "BUY";
    document.getElementById('strat-timeframe').value = "15m";
    document.getElementById('strat-universe-mode').value = "intraday";
    document.getElementById('strat-target-query').value = ""; // Clear new fields
    document.getElementById('strat-sl-query').value = ""; // Clear new fields
    document.getElementById('strat-accum-query').value = ""; // Clear new fields
    updateStrategyExplainer();
    showToast("Strategy logic loaded into editor (legacy).", "info");
}

async function deleteStrategyFromServer(id) {
    if (!confirm("Delete this strategy permanently?")) return;
    try {
        await fetch(`/api/strategies/${id}`, { method: 'DELETE' });
        renderSavedStrategies();
    } catch (e) {
        console.error(e);
    }
}

// This function is now deprecated as strategies are loaded from server
function loadStrategy(id) {
    const saved = JSON.parse(localStorage.getItem('app_strategies_v2') || '[]');
    const strat = saved.find(s => s.id === id);
    if (!strat) return;

    document.getElementById('strat-name').value = strat.name;
    document.getElementById('strat-entry-query').value = strat.query;
    document.getElementById('strat-target-query').value = strat.target || ""; // Changed to query
    document.getElementById('strat-sl-query').value = strat.sl || ""; // Changed to query
    // document.getElementById('strat-pyramid').value = strat.pyramid || "50,25,25"; // This field is not in the new form
    updateStrategyExplainer(); // Added to update explainer
}

// This function is now deprecated as strategies are managed on server
function deleteStrategy(id) {
    if (!confirm("Delete this query?")) return;
    let saved = JSON.parse(localStorage.getItem('app_strategies_v2') || '[]');
    saved = saved.filter(s => s.id !== id);
    localStorage.setItem('app_strategies_v2', JSON.stringify(saved));
    renderSavedStrategies();
}

/**
 * CORE ENGINE: DSL Scanner
 */
let strategyLabState = {
    cachedData: {}
};

async function runStrategyScan() {
    const btn = document.getElementById('strategy-run-btn');
    const statusEl = document.getElementById('query-status');
    const entryLogic = document.getElementById('strat-entry-query').value.trim();
    const side = document.getElementById('strat-side').value;
    const timeframe = document.getElementById('strat-timeframe').value;
    const universeMode = currentMode; // Decided based on Strategy Mode (App context)

    if (!entryLogic) return alert("Define entry criteria first!");

    // 1. Translate Segmented Logic
    const translation = translateUserQuery(entryLogic, side, timeframe);
    const query = translation.query;
    const defaultTf = translation.primaryTf; // This now comes from the form field or query

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
    btn.disabled = true;
    if (statusEl) statusEl.innerText = "Analyzing Query...";

    const resultsGrid = document.getElementById('strat-results-grid');
    const matchCountBadge = document.getElementById('strat-match-count');

    try {
        // 2. Parse Timeframes from the translated query
        const tfRegex = /\[(.*?)\]/g;
        let match;
        const usedTfs = [];
        while ((match = tfRegex.exec(query)) !== null) {
            usedTfs.push(match[1]);
        }

        if (usedTfs.length === 0) {
            usedTfs.push(defaultTf);
        }

        // 3. Fetch Data for all required timeframes
        const tfDataMap = {};
        await Promise.all([...new Set(usedTfs)].map(async (tf) => {
            const apiTf = TF_MAP[tf] || tf;
            // Respect the universe selection (intraday vs swing)
            const res = await fetch(`/api/signals?mode=${universeMode}&timeframe=${apiTf}`);
            const json = await res.json();
            if (json.status === 'success') tfDataMap[tf] = json.data;
        }));

        // 4. Prepare Evaluation Engine
        const indMap = {
            'RSI': 'rsi',
            'ST': 'supertrend_dir',
            'ST_V': 'supertrend_value',
            'LTP': 'ltp',
            'EMA_C': 'ema_signal',
            'EMA_F': 'ema_fast',
            'EMA_S': 'ema_slow',
            'EMA_V': 'ema_value',
            'VOL': 'volume_signal',
            'VOL_R': 'volume_ratio',
            'roe': 'roe',
            'pe': 'pe',
            'pb': 'pb',
            'eps': 'eps',
            'opm': 'opm',
            'npm': 'npm',
            'sector': 'sector',
            'industry': 'industry',
            'market_cap': 'market_cap',
            'prev_high': 'prev_high',
            'prev_low': 'prev_low'
        };

        let processedQuery = query
            .replace(/AND /gi, '&& ')
            .replace(/OR /gi, '|| ')
            .replace(/NOT /gi, '! ')
            .replace(/==/g, '===');

        // Handle Percentage Arithmetic: [token] +/- X%
        // This regex handles patterns like [1h].ST_V - 0.15% or [5m].LTP + 1%
        const pctRegex = /(\[.*?\]\.[A-Z_0-9]+)\s*([\+\-])\s*(\d+\.?\d*)%/g;
        processedQuery = processedQuery.replace(pctRegex, (match, token, op, val) => {
            const factor = op === '+' ? (1 + (parseFloat(val) / 100)) : (1 - (parseFloat(val) / 100));
            return `(${token} * ${factor})`;
        });

        // 5. Token Resolution
        const tokenRegex = /\[(.*?)\]\.([A-Z_a-z0-9]+)/g;
        const tokens = [];
        let tMatch;
        while ((tMatch = tokenRegex.exec(query)) !== null) {
            tokens.push({
                full: tMatch[0],
                tf: tMatch[1],
                attr: indMap[tMatch[2]] || tMatch[2]
            });
        }

        // 6. Evaluate Matches
        const masterList = tfDataMap[usedTfs[0]] || [];
        const matches = [];

        masterList.forEach(stock => {
            let evalStr = processedQuery;
            let skip = false;

            tokens.forEach(token => {
                const tfData = tfDataMap[token.tf] || [];
                const s = tfData.find(item => item.isin === stock.isin);
                if (!s) { skip = true; return; }

                let val = s[token.attr];
                if (token.attr === 'volume_signal') { // Corrected from 'vol_signal'
                    val = val === 'BULL_SPIKE' ? "'BULL_S'" : (val === 'BEAR_SPIKE' ? "'BEAR_S'" : "'NONE'");
                } else if (typeof val === 'string') {
                    val = `'${val}'`;
                } else {
                    val = val || 0;
                }

                // Global replacement for the token in the query
                const escapedToken = token.full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                evalStr = evalStr.replace(new RegExp(escapedToken, 'g'), val);
            });

            if (skip) return;

            try {
                // Use the side from the form for evaluation
                if (new Function(`return ${evalStr}`)()) {
                    const levels = calculateStaticLevels(stock, tfDataMap);
                    matches.push({ ...stock, levels, side: side, isMatch: true });
                }
            } catch (e) {
                if (masterList.indexOf(stock) === 0) console.error("Eval Error for first stock:", e, "Code:", evalStr);
            }
        });

        renderScanResults(matches);
        if (matchCountBadge) {
            matchCountBadge.innerText = `${matches.length} Matches`;
            matchCountBadge.style.display = 'inline-block';
        }
        if (statusEl) {
            statusEl.innerText = `Scan Complete: ${matches.length} Found`;
            statusEl.style.color = "var(--success)";
        }

    } catch (err) {
        console.error("Scan Error:", err);
        if (statusEl) {
            statusEl.innerText = "Execution Error";
            statusEl.style.color = "var(--danger)";
        }
    } finally {
        btn.innerHTML = '<i class="fas fa-bolt"></i> RUN STRATEGY SCAN';
        btn.disabled = false;
    }
}

function calculateStaticLevels(stock, tfDataMap) {
    const ltp = stock.ltp;

    const side = document.getElementById('strat-side').value;
    const targetQuery = document.getElementById('strat-target-query').value;
    const slQuery = document.getElementById('strat-sl-query').value;

    let targetPrice = ltp * (side === 'BUY' ? 1.008 : 0.992); // Default small percentage
    let slPrice = ltp * (side === 'BUY' ? 0.995 : 1.005); // Default small percentage

    // Resolve Target
    const tPctMatch = targetQuery.match(/(\d+\.?\d*)\s*%/);
    if (tPctMatch) {
        const pct = parseFloat(tPctMatch[1]);
        targetPrice = side === 'BUY' ? ltp * (1 + pct / 100) : ltp * (1 - pct / 100);
    } else if (targetQuery.includes('High') || targetQuery.includes('Low') || targetQuery.includes('Prev_High') || targetQuery.includes('Prev_Low')) {
        // Dynamic Price Tagging (Simplified)
        const tfKeyMatch = targetQuery.match(/\[(.*?)\]/);
        const tfKey = tfKeyMatch ? tfKeyMatch[1] : '1d'; // Default to 1d if no TF specified
        const tfData = tfDataMap[tfKey] || [];
        const relevantStockData = tfData.find(s => s.isin === stock.isin);

        if (relevantStockData) {
            if (targetQuery.includes('High') || targetQuery.includes('Prev_High')) {
                targetPrice = relevantStockData.prev_high || ltp * (side === 'BUY' ? 1.015 : 0.985);
            } else if (targetQuery.includes('Low') || targetQuery.includes('Prev_Low')) {
                targetPrice = relevantStockData.prev_low || ltp * (side === 'BUY' ? 1.015 : 0.985);
            }
        } else {
            targetPrice = ltp * (side === 'BUY' ? 1.015 : 0.985); // Fallback
        }
    }

    // Resolve SL
    const sPctMatch = slQuery.match(/(\d+\.?\d*)\s*%/);
    if (sPctMatch) {
        const pct = parseFloat(sPctMatch[1]);
        slPrice = side === 'BUY' ? ltp * (1 - pct / 100) : ltp * (1 + pct / 100);
    } else if (slQuery.includes('ST_V') || slQuery.includes('SuperTrendValue')) {
        const tfKeyMatch = slQuery.match(/\[(.*?)\]/);
        const tfKey = tfKeyMatch ? tfKeyMatch[1] : '1h'; // Default to 1h if no TF specified
        const tfData = tfDataMap[tfKey] || [];
        const relevantStockData = tfData.find(s => s.isin === stock.isin);

        if (relevantStockData && relevantStockData.supertrend_value) {
            slPrice = relevantStockData.supertrend_value;
        } else {
            slPrice = ltp * (side === 'BUY' ? 0.97 : 1.03); // Fallback
        }
    } else if (slQuery.includes('EMA_F') || slQuery.includes('EMA_S')) {
        const tfKeyMatch = slQuery.match(/\[(.*?)\]/);
        const tfKey = tfKeyMatch ? tfKeyMatch[1] : '1h'; // Default to 1h if no TF specified
        const tfData = tfDataMap[tfKey] || [];
        const relevantStockData = tfData.find(s => s.isin === stock.isin);

        if (relevantStockData) {
            if (slQuery.includes('EMA_F')) {
                slPrice = relevantStockData.ema_fast || ltp * (side === 'BUY' ? 0.97 : 1.03);
            } else if (slQuery.includes('EMA_S')) {
                slPrice = relevantStockData.ema_slow || ltp * (side === 'BUY' ? 0.97 : 1.03);
            }
        } else {
            slPrice = ltp * (side === 'BUY' ? 0.97 : 1.03); // Fallback
        }
    }

    return { target: targetPrice, sl: slPrice };
}

// Helper function for currency formatting (assuming it's not globally defined)
function formatCurrency(value) {
    return parseFloat(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderScanResults(matches, isFilter = false) {
    const grid = document.getElementById('strat-results-grid');
    if (!isFilter) lastScanMatches = matches;

    if (!matches.length) {
        grid.innerHTML = `<tr><td colspan="6" style="padding: 100px; text-align:center; opacity: 0.3;">
            <i class="fas fa-ghost fa-3x" style="margin-bottom:20px;"></i>
            <p style="font-size:14px;">No matching symbols found in current scan.</p>
        </td></tr>`;
        return;
    }

    grid.innerHTML = matches.map(s => {
        const sideColor = s.side === 'BUY' ? 'var(--success)' : 'var(--danger)';
        const ltpVal = formatCurrency(s.ltp);
        const tgVal = formatCurrency(s.levels.target);
        const slVal = formatCurrency(s.levels.sl);

        return `
            <tr class="strat-card" data-isin="${s.isin}" style="border-bottom: 1px solid rgba(255,255,255,0.02);">
                <td style="padding: 15px 20px;">
                    <div style="font-weight: 700; color: var(--text-main);" class="symbol-name">${s.symbol}</div>
                    <div style="font-size: 10px; opacity: 0.5;">${s.isin}</div>
                </td>
                <td style="padding: 15px 20px; text-align: right; font-weight: 800; color: var(--amber);" class="ltp-val">
                    ₹${ltpVal}
                </td>
                <td style="padding: 15px 20px; text-align: center;">
                    <span class="badge" style="background: ${sideColor}20; color: ${sideColor}; border: 1px solid ${sideColor}40; font-weight: 800;">
                        ${s.side}
                    </span>
                </td>
                <td style="padding: 15px 20px; text-align: right; font-weight: 700; color: var(--success);">
                    ₹${tgVal}
                </td>
                <td style="padding: 15px 20px; text-align: right; font-weight: 700; color: var(--danger);">
                    ₹${slVal}
                </td>
                <td style="padding: 15px 20px; text-align: center;">
                    <div style="display: flex; gap: 8px; justify-content: center;">
                        <button class="btn btn-primary" style="height: 32px; padding: 0 12px; font-size: 11px;" 
                            onclick="commitToTrade('${s.isin}', ${s.levels.target}, ${s.levels.sl})">
                            <i class="fas fa-bolt"></i> Trade
                        </button>
                        <button class="btn btn-dim" style="height: 32px; width: 32px; padding: 0;" 
                            onclick="showCandlesPopup('${s.isin}', '${s.symbol}')">
                            <i class="fas fa-chart-line"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function commitToTrade(isin, target, sl) {
    const symbol = document.querySelector(`.strat-card[data-isin="${isin}"] .symbol-name`)?.innerText || isin;
    const ltp = parseFloat(document.querySelector(`.strat-card[data-isin="${isin}"] .ltp-val`)?.innerText.replace(/,/g, '')) || 0;

    if (!ltp) return alert("Price unavailable for commit.");

    const query = document.getElementById('strat-entry-query').value;
    const side = document.getElementById('strat-side').value || "BUY";

    const qty = prompt(`Enter quantity for confluence-validated ${side} trade in ${symbol} at ₹${ltp}:`, "100");
    if (!qty || isNaN(qty)) return;

    const payload = {
        isin: isin,
        symbol: symbol,
        mode: document.getElementById('strat-universe-mode').value,
        timeframe: 'confluence',
        entry_price: ltp,
        target: target,
        stop_loss: sl,
        side: side,
        qty: parseInt(qty),
        query_context: query
    };

    try {
        const res = await fetch('/api/trades/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.status === 'success') {
            showToast(`🚀 Confluence ${side} trade active for ${symbol}! Check Paper Trading for monitoring.`, "success");
        }
    } catch (e) {
        console.error(e);
        showToast("Failed to commit trade logic.", "error");
    }
}
