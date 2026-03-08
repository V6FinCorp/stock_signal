// --- Utilities ---
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: ${type === 'success' ? '#089981' : (type === 'error' ? '#F23645' : '#2962FF')};
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-weight: 600;
        font-size: 14px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        z-index: 9999;
        animation: slideUp 0.3s ease-out;
    `;
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

const tableControllers = {
    dashboard: null,
    screener: null,
    lab: null
};

function showTableSkeleton(tbodyId, columns = 0, rows = 10) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    
    // Auto-detect columns from thead if available for better alignment
    let colToRender = columns;
    if (colToRender === 0) {
        const table = tbody.closest('table');
        if (table) {
            const thead = table.querySelector('thead');
            const headRow = thead ? thead.querySelector('tr') : null;
            if (headRow) {
                // Count visible or all TH elements
                colToRender = headRow.querySelectorAll('th').length;
            }
        }
    }
    if (colToRender === 0) colToRender = 8; // Fallback
    
    let html = '';
    for (let i = 0; i < rows; i++) {
        let cells = '';
        for (let j = 0; j < colToRender; j++) {
            cells += `<td><div class="skeleton-box" style="width: ${Math.random() * 50 + 40}%"></div></td>`;
        }
        html += `<tr class="skeleton-row">${cells}</tr>`;
    }
    tbody.innerHTML = html;
}

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
    "Weekly": "1w",
    "Monthly": "1mo",
    "1h": "60m",
    "60m": "60m",
    "30m": "30m",
    "15m": "15m",
    "5m": "5m",
    "1m": "1m"
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
let isSectorBarCollapsed = true;
let activeTab = 'dashboard';
let appZoom = 1.0;
let screenerMasterData = []; // Cache for local screener filtering

let currentEditorMode = 'query';
let currentStrategyId = null; 
let HUD_STATES = {
    swing: { active: false, expanded: false },
    intraday: { active: false, expanded: false }
};

let autoSyncTimerId = null;
let isAutoSyncEnabled = false;
let currentUsername = 'admin'; // Fallback
let activeScreenerBlueprint = null;
let screenerBlueprints = [];
let screenerTfDataMap = {}; // Shared cache for MTF data in Screener

// --- Authentication & Session ---
async function verifySession() {
    try {
        const res = await fetch('/api/auth/verify');
        const data = await res.json();
        if (data.status === 'success') {
            currentUsername = data.username;
            // Update UI username if exists
            const el = document.querySelector('.user-name');
            if (el) el.innerText = currentUsername === 'admin' ? 'V6 Admin' : currentUsername;
        } else {
            window.location.reload(); // Redirect to login via '/'
        }
    } catch (e) {
        console.warn("Auth verification error:", e);
    }
}

async function logoutSession() {
    if (confirm("Are you sure you want to log out from SignalPro?")) {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/';
        } catch (e) {
            alert("Logout failed. Please check connection.");
        }
    }
}

async function changeUserPassword() {
    const oldPass = document.getElementById('change-old-pass').value;
    const newPass = document.getElementById('change-new-pass').value;
    const confirmPass = document.getElementById('change-confirm-pass').value;

    if (!oldPass || !newPass) {
        showToast("Please fill all password fields", "error");
        return;
    }

    if (newPass !== confirmPass) {
        showToast("New passwords do not match", "error");
        return;
    }

    if (newPass.length < 6) {
        showToast("Password must be at least 6 characters", "error");
        return;
    }

    try {
        const res = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: currentUsername,
                old_password: oldPass,
                new_password: newPass
            })
        });
        const result = await res.json();

        if (result.status === 'success') {
            showToast("Password updated. Please log in again.", "success");
            // Automatically log out so they have to use the new password
            setTimeout(() => {
                fetch('/api/auth/logout', { method: 'POST' }).then(() => window.location.reload());
            }, 2000);
        } else {
            showToast(result.detail || "Failed to update password. Current password may be wrong.", "error");
        }
    } catch (e) {
        showToast("An error occurred. check server log.", "error");
    }
}

// --- Core API Logic ---

async function fetchAndRenderSignals(forceFetch = false) {
    const apiTf = TF_MAP[currentTimeframe] || '1d';
    const cacheKey = `${currentMode}_${apiTf}`;

    // Return instant cached data from memory/local storage if available
    if (!forceFetch && signalCache[cacheKey]) {
        liveSignals = signalCache[cacheKey];
        renderSignals();
        // Even if we have cache, if it's the first load, we might want to refresh anyway
        // but not block the UI. So we continue but don't show skeleton.
    } else {
        const tbody = document.getElementById('signal-tbody');
        showTableSkeleton('signal-tbody'); 
    }

    // Clear stats and header times during load to prevent stale data
    const statIds = ['stat-total', 'stat-bullish', 'stat-bearish', 'stat-confluence'];
    statIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<div class="skeleton-box" style="width:40px;height:16px;"></div>';
    });
    const timeIds = ['last-fetch-time', 'last-calc-time', 'latest-ohlc-time'];
    timeIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<div class="skeleton-box" style="width:60px;display:inline-block;height:10px;"></div>';
    });

    // Abort previous request if still pending
    if (tableControllers.dashboard) tableControllers.dashboard.abort();
    tableControllers.dashboard = new AbortController();

    try {
        const response = await fetch(`/api/signals?mode=${currentMode}&timeframe=${apiTf}`, {
            signal: tableControllers.dashboard.signal
        });
        const result = await response.json();

        if (result.status === 'success') {
            liveSignals = result.data;
            signalCache[cacheKey] = liveSignals; // Save to memory cache
            saveConfigsToLocalStorage(); // Persist to local storage
        } else {
            console.error(result.message);
            liveSignals = [];
        }
    } catch (e) {
        if (e.name === 'AbortError') return; // Ignore expected abonts
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

function setMode(mode, skipFetch = false) {
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
        if (!skipFetch) fetchAndRenderSignals(true); 
    } else if (activeTab === 'pro-screener') {
        renderProScreener();
    } else if (activeTab === 'settings') {
        loadProfileSettings();
    } else if (activeTab === 'strategy-lab') {
        updateStrategyLabOptions();
    }

    updateScreenerTimeframeOptions();
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

function updateScreenerTimeframeOptions() {
    const select = document.getElementById('screener-filter-tf');
    if (!select) return;

    const mode = currentMode;
    const options = mode === 'swing'
        ? [["1d", "Daily"], ["1w", "Weekly"], ["1mo", "Monthly"]]
        : [["5m", "5 Minute"], ["15m", "15 Minute"], ["30m", "30 Minute"], ["60m", "1 Hour"]];

    // Preserve "All" option if already selected, or default to All
    const currentVal = select.value;
    select.innerHTML = '<option value="all">Timeframe: All</option>' +
        options.map(([val, label]) => `<option value="${val}">${label}</option>`).join('');

    if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
        select.value = currentVal;
    } else {
        select.value = "all";
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

            let l5_data = stock.last_5_candles;
            if (typeof l5_data === 'string' && l5_data.trim()) {
                try { l5_data = JSON.parse(l5_data); } catch (e) { console.error("Failed to parse candle data", e); }
            }

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
                let svgContent = `<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" style="cursor: pointer;" onclick="showCandlesPopup('${stock.isin}', '${stock.symbol}', ${stock.ltp}, this.dataset.pattern, this.dataset.candles)" data-candles="${rawDataJson}" data-pattern="${patternLabel}">`;

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
            const score = stock.pattern_score || 0;
            let textHtml = '';
            if (pattern) {
                let textColor = "var(--text-dim)";
                if (pattern.includes("Bullish")) textColor = "var(--success)";
                else if (pattern.includes("Bearish")) textColor = "var(--danger)";

                let scoreHtml = '';
                if (score > 0) {
                    scoreHtml = `<div style="display: flex; gap: 3px; margin-top: 4px;" title="Strength Score: ${score}/3">`;
                    for (let i = 0; i < 3; i++) {
                        scoreHtml += `<div style="width: 4px; height: 4px; border-radius: 50%; background: ${i < score ? textColor : 'rgba(255,255,255,0.1)'};"></div>`;
                    }
                    scoreHtml += `</div>`;
                }

                textHtml = `<div class="pattern-text" style="color: ${textColor};" title="${pattern}">${pattern}${scoreHtml}</div>`;
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
            let dma_data = stock.dma_data;
            if (typeof dma_data === 'string' && dma_data.trim()) {
                try { dma_data = JSON.parse(dma_data); } catch (e) { }
            }
            conf.dma.periods.forEach(p => {
                const dmaVal = dma_data ? dma_data[`SMA_${p}`] : null;
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

    if (!conf.localization) conf.localization = { timezone: 'IST' };
    const tzEl = document.getElementById('setting-timezone-standard');
    if (tzEl) tzEl.value = conf.localization.timezone || 'IST';

    // Fetch Global Session Settings
    fetch(`/api/settings/load?profile=global`)
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success' && data.settings && data.settings.session) {
                document.getElementById('setting-session-duration').value = data.settings.session.hours || 24;
            }
        }).catch(err => console.warn("Failed to load global session settings"));
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

    if (!conf.localization) conf.localization = {};
    const tzEl = document.getElementById('setting-timezone-standard');
    if (tzEl) conf.localization.timezone = tzEl.value;

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

    // Prepare promises for parallel saving
    const saveMode = fetch('/api/settings/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            profile: profile,
            settings: conf
        })
    }).then(res => res.json());

    const sessionHours = parseInt(document.getElementById('setting-session-duration').value) || 24;
    const saveGlobal = fetch('/api/settings/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            profile: 'global',
            settings: { session: { hours: sessionHours } }
        })
    }).then(res => res.json());

    Promise.all([saveMode, saveGlobal])
        .then(results => {
            console.log("DB Settings Sync Results:", results);
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
            alert("Settings saved locally, but failed to sync with Database.");
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
    } else if (tabId === 'history') {
        loadSignalHistory();
    } else if (tabId === 'support') {
        renderSupportGuide();
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

            const coverage = result.data.coverage || {};
            if (Object.keys(coverage).length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;" class="text-dim">No raw OHLCV data found.</td></tr>';
            } else {
                for (const [tf, stats] of Object.entries(coverage)) {
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

async function loadSignalHistory() {
    const tbody = document.getElementById('history-tbody');
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:40px;"><i class="fas fa-spinner fa-spin"></i> Loading historical intelligence...</td></tr>';

    const mode = document.getElementById('history-filter-mode').value;
    const tf = document.getElementById('history-filter-tf').value;

    try {
        const res = await fetch(`/api/history?mode=${mode}&timeframe=${tf}&limit=100`);
        const result = await res.json();

        if (result.status === 'success' && result.data.length > 0) {
            tbody.innerHTML = '';
            result.data.forEach(log => {
                const tr = document.createElement('tr');
                const rankClass = log.confluence_rank >= 4 ? 'text-success' : 'text-danger';
                const strategyClass = log.trade_strategy.includes('PERFECT') ? 'badge-perfect' : 'badge-normal';

                tr.innerHTML = `
                    <td class="text-dim" style="font-size: 11px;">${log.timestamp}</td>
                    <td style="font-weight: 700;">${log.symbol || log.isin}</td>
                    <td><span class="strategy-badge ${strategyClass}" style="font-size: 10px; padding: 2px 6px;">${log.trade_strategy}</span></td>
                    <td class="text-dim">${log.timeframe}</td>
                    <td class="${rankClass}" style="font-weight: 800;">${log.confluence_rank > 0 ? '+' : ''}${log.confluence_rank}</td>
                    <td style="font-weight: 600;">₹${parseFloat(log.ltp).toFixed(1)}</td>
                    <td class="text-dim">${log.rsi ? parseFloat(log.rsi).toFixed(1) : '-'}</td>
                    <td class="text-success" style="font-size: 12px; font-weight: 600;">${log.target ? log.target.toFixed(1) : '-'}</td>
                    <td class="text-danger" style="font-size: 12px; font-weight: 600;">${log.sl ? log.sl.toFixed(1) : '-'}</td>
                `;
                tbody.appendChild(tr);
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:40px; color:var(--text-dim);">No significant historical signals found yet. Run calculations to generate logs.</td></tr>';
        }
    } catch (e) {
        console.error("History Load Error:", e);
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:40px; color:var(--danger);">Connection failed while fetching history.</td></tr>';
    }
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').classList.add('hidden');
    document.getElementById('confirm-input').value = '';
}

function openStrategyHelp() {
    document.getElementById('strategy-help-modal').classList.remove('hidden');
}

function closeStrategyHelp() {
    document.getElementById('strategy-help-modal').classList.add('hidden');
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
    const consoleEl = document.getElementById(`hud-console-${mode}`);
    HUD_STATES[mode].expanded = !HUD_STATES[mode].expanded;
    consoleEl.classList.toggle('hidden', !HUD_STATES[mode].expanded);
}

async function fetchMarketData() {
    const mode = currentMode;
    const btn = document.getElementById('fetch-data-btn');
    const hud = document.getElementById(`job-hud-${mode}`);
    const bar = document.getElementById(`hud-bar-${mode}`);
    const percent = document.getElementById(`hud-percent-${mode}`);
    const statusText = document.getElementById(`hud-status-${mode}`);
    const consoleEl = document.getElementById(`hud-console-${mode}`);

    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';
    btn.classList.add('btn-disabled');
    btn.disabled = true;

    HUD_STATES[mode].active = true;
    syncHudVisibility();
    consoleEl.innerHTML = '';
    statusText.innerText = `Fetching ${mode.toUpperCase()} Market Data...`;

    const evtSource = new EventSource(`/api/stream/fetch-data?mode=${mode}`);
    fetchEvtSource = evtSource;

    evtSource.onopen = function () {
        console.log("SSE Connection Opened for Fetching...");
        statusText.innerText = "Connection Established. Fetching Data...";
    };

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

        consoleEl.appendChild(logLine);
        consoleEl.scrollTop = consoleEl.scrollHeight;
    };

    evtSource.onerror = function (err) {
        console.error("SSE Connection Error:", err);
        evtSource.close();
        fetchEvtSource = null;
        HUD_STATES[mode].active = false;
        syncHudVisibility();
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        alert("Failed to connect to the data stream. Check if the server is running.");
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
    const btn = document.getElementById('calc-signals-btn');
    const icon = document.getElementById('refresh-icon');
    const originalHTML = btn.innerHTML;

    icon.classList.add('fa-spin');
    btn.disabled = true;

    try {
        const mode = currentMode;
        const fundamentals = (CONFIGS[mode] && CONFIGS[mode].fundamentals && CONFIGS[mode].fundamentals.enabled) || false;

        const res = await fetch(`/api/calculate?mode=${mode}&fundamentals=${fundamentals}`, { method: 'POST' });
        const result = await res.json();

        if (result.status === 'success') {
            await fetchAndRenderSignals(true);
            await fetchSystemStatus();
            showToast("Calculations updated successfully.", "success");
        } else {
            showToast("Calculation failed: " + result.detail, "error");
        }
    } catch (e) {
        showToast("Error during calculation. Check server.", "error");
    } finally {
        icon.classList.remove('fa-spin');
        btn.disabled = false;
    }
}

async function fetchSystemStatus() {
    // Show short skeletons while fetching status to avoid 'Never' flicker
    const timeIds = ['last-fetch-time', 'last-calc-time', 'latest-ohlc-time'];
    timeIds.forEach(id => {
        const el = document.getElementById(id);
        // Only show if not already showing a real value (prevent flickering during auto-sync)
        if (el && (el.innerText === 'Never' || el.children.length === 0)) {
            el.innerHTML = '<div class="skeleton-box" style="width:60px;display:inline-block;height:10px;"></div>';
        }
    });

    try {
        const res = await fetch(`/api/status?mode=${currentMode}`);
        const result = await res.json();
        if (result.status === 'success') {
            const fetchEl = document.getElementById('last-fetch-time');
            const calcEl = document.getElementById('last-calc-time');
            const ohlcEl = document.getElementById('latest-ohlc-time');

            const tzSuffix = (CONFIGS[currentMode] && CONFIGS[currentMode].localization && CONFIGS[currentMode].localization.timezone === 'IST') ? ' IST' : '';

            if (fetchEl) fetchEl.innerText = result.last_fetch + (result.last_fetch !== "Never" ? tzSuffix : "");
            if (calcEl) calcEl.innerText = result.last_calc + (result.last_calc !== "Never" ? tzSuffix : "");
            if (ohlcEl) ohlcEl.innerText = result.ohlc_time + (result.ohlc_time !== "Never" ? tzSuffix : "");
        } else if (result.status === 'error') {
            console.error("System Status Error:", result.message);
        }
    } catch (e) {
        console.error("Failed to fetch system status:", e);
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
    // No-op: Dual sliders for screener targets/sl replaced by numeric inputs for compactness
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
    ltp: 0,
    pattern: '',
    activeTfs: [], // Array of strings e.g. ["5m", "15m"]
    isSplit: false
};

async function showCandlesPopup(isin, symbol, ltp = 0, patternName = '', fallbackCandlesJson = '', requestedTf = null) {
    // Reset or Initialize State if it's a new stock
    if (modalTfState.isin !== isin) {
        modalTfState.isin = isin;
        modalTfState.symbol = symbol;
        modalTfState.ltp = ltp;
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
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; flex-shrink: 0;">
                <div>
                    <div style="display: flex; align-items: baseline; gap: 10px;">
                        <h3 style="margin: 0; font-size: 22px; font-weight: 700;">${symbol}</h3>
                        <span id="modal-ltp-display" style="font-size: 16px; color: var(--text-dim); font-weight: 600;">LTP: ${(ltp || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div id="modal-condition-row" style="margin-top: 6px; font-size: 13px; color: var(--text-dim); display: ${patternName ? 'block' : 'none'};">
                        <span style="color:var(--amber)">Condition:</span> <span id="modal-condition-text">${patternName || ""}</span>
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

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-shrink: 0;">
                <div style="display: flex; gap: 6px; flex-wrap: wrap;" id="modal-tf-buttons">
                    ${allTfs.map(tf => {
                        const isActive = modalTfState.activeTfs.includes(tf);
                        return `<button onclick="handleModalTfClick('${tf}')" 
                                class="tf-btn ${isActive ? 'active' : ''}"
                                style="font-size: 11px; padding: 4px 10px; min-width: 50px;">${tf}</button>`;
                    }).join('')}
                </div>
                <div id="modal-split-toggle" onclick="toggleModalSplitMode()" title="Split View (Max 4)" style="cursor: pointer; padding: 6px 10px; border-radius: 8px; background: ${modalTfState.isSplit ? 'var(--primary)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${modalTfState.isSplit ? 'var(--primary)' : 'var(--border-color)'}; color: ${modalTfState.isSplit ? '#fff' : 'var(--text-dim)'}; transition: all 0.2s; font-size: 0.7rem;">
                    <i class="fas fa-th-large"></i> Split View
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
    showCandlesPopup(modalTfState.isin, modalTfState.symbol, modalTfState.ltp, modalTfState.pattern);
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
    showCandlesPopup(modalTfState.isin, modalTfState.symbol, modalTfState.ltp, modalTfState.pattern);
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
            // Update UI with metadata from this TF
            if (chartData.meta) {
                const meta = chartData.meta;
                const patternText = meta.pattern || "No pattern detected";

                // 1. Update main header if single view
                if (!modalTfState.isSplit) {
                    const condText = document.getElementById('modal-condition-text');
                    const condRow = document.getElementById('modal-condition-row');
                    if (condText) {
                        condText.innerText = patternText;
                        condRow.style.display = 'block';
                    }

                    // Update LTP Display from meta if available
                    if (meta.ltp) {
                        modalTfState.ltp = meta.ltp;
                        const ltpEl = document.getElementById('modal-ltp-display');
                        if (ltpEl) ltpEl.innerText = `LTP: ${meta.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
                    }
                }

                // 2. Update slot header (Sub-header)
                if (slotLegend) {
                    let stHtml = '';
                    if (meta.st_dir) {
                        const color = meta.st_dir === 'BUY' ? 'var(--success)' : 'var(--danger)';
                        stHtml = `<span style="color:${color}; font-weight:700;">${meta.st_dir}</span>`;
                    }
                    const pScore = meta.pattern_score || 0;
                    const pScoreColor = pScore > 0 ? 'var(--success)' : (pScore < 0 ? 'var(--danger)' : 'var(--text-dim)');
                    slotLegend.innerHTML = `
                        ${meta.pattern ? `<span style="color:var(--amber); border: 1px solid rgba(245,158,11,0.2); background: rgba(245,158,11,0.05); padding: 1px 6px; border-radius: 4px;">${meta.pattern}</span>` : ''}
                        ${stHtml}
                        <span style="opacity: 0.8; font-weight: 600;">(Rank: ${meta.rank || 0} | <span style="color:${pScoreColor};">Score: ${pScore > 0 ? '+' : ''}${pScore}</span>)</span>
                    `;
                }
            }

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

    const emaKeysForScale = opts.ema ? Object.keys(candles[0] || {}).filter(k => k.startsWith('EMA_')) : [];

    candles.forEach(c => {
        if (c.l < minL) minL = c.l;
        if (c.h > maxH) maxH = c.h;
        if (c.v > maxV) maxV = c.v;

        // Include indicator values in scale
        if (opts.ema) {
            emaKeysForScale.forEach(key => {
                const val = c[key];
                if (val !== null && val !== undefined) {
                    if (val < minL) minL = val;
                    if (val > maxH) maxH = val;
                }
            });
        }
        if (opts.st && c.ST_value !== null && c.ST_value !== undefined) {
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
                if (val !== null && val !== undefined) {
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

                if (prevF !== null && prevS !== null && currF !== null && currS !== null) {
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
            if (p.ST_value !== null && p.ST_value !== undefined && c.ST_value !== null && c.ST_value !== undefined) {
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
            if (val !== null && val !== undefined && val >= minL && val <= maxH) {
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
            if (val !== null && val !== undefined) {
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
    console.log("App Initializing...");
    
    // 1. Load everything from LocalStorage FIRST (Fastest)
    loadConfigsFromLocalStorage();
    
    // 2. Immediate UI Setup (No waiting for API)
    setupRSISlider(); 
    applyZoom(); 
    switchTab('dashboard');
    setMode(currentMode, true); // skipFetch=true to use ONLY cache for now
    
    // 3. Background Verification & ONE Fresh Data Fetch
    verifySession().then(() => {
        console.log("Session verified.");
        // Fresh fetch if we're on dashboard
        if (activeTab === 'dashboard') {
            fetchAndRenderSignals(true); 
        }
    });

    fetchSystemStatus();
});

function saveConfigsToLocalStorage() {
    const payload = {
        configs: CONFIGS,
        cache: signalCache,
        lastMode: currentMode,
        lastTab: activeTab
    };
    localStorage.setItem('stock_signal_v2_data', JSON.stringify(payload));
}

function loadConfigsFromLocalStorage() {
    const saved = localStorage.getItem('stock_signal_v2_data');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            if (data.configs) Object.assign(CONFIGS, data.configs);
            if (data.cache) signalCache = data.cache;
            if (data.lastMode) currentMode = data.lastMode;
            // Note: lastTab is handled by initialization logic
        } catch (e) {
            console.error("Failed to load saved data:", e);
        }
    }
}

// --- Pro Screener & Paper Trading Logic ---

async function renderProScreener() {
    const tbody = document.getElementById('screener-tbody');
    const sentimentPlaceholder = document.getElementById('screener-sentiment-placeholder');
    if (!tbody || !sentimentPlaceholder) return;

    showTableSkeleton('screener-tbody'); // Auto-detect columns for perfect match

    if (tableControllers.screener) tableControllers.screener.abort();
    tableControllers.screener = new AbortController();

    try {
        const tf = document.getElementById('screener-filter-tf')?.value || 'all';
        const response = await fetch(`/api/signals?mode=${currentMode}&timeframe=${tf}`, {
            signal: tableControllers.screener.signal
        });
        const result = await response.json();
        if (result.status !== 'success') throw new Error("API Failure");

        // Fetch all data for the screener; applyScreenerFilters will handle the high-conviction pre-filter if no blueprint is active
        screenerMasterData = result.data || [];
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
    const customFilterId = document.getElementById('screener-filter-custom').value;

    const targetMin = parseFloat(document.getElementById('screener-target-min')?.value || 0);
    const targetMax = parseFloat(document.getElementById('screener-target-max')?.value || 100);
    const slMin = parseFloat(document.getElementById('screener-sl-min')?.value || 0);
    const slMax = parseFloat(document.getElementById('screener-sl-max')?.value || 100);

    let filtered = screenerMasterData.filter(s => {
        // 1. Search filter
        const matchesSearch = s.symbol.toLowerCase().includes(searchTerm) || s.isin.toLowerCase().includes(searchTerm);
        if (!matchesSearch) return false;

        // 2. High-Conviction Filter: Default to Absolute Rank 4+ if no custom strategy is active
        const customFilterId = document.getElementById('screener-filter-custom')?.value || 'none';
        if (customFilterId === 'none') {
            const absRank = Math.abs(s.confluence_rank || 0);
            if (absRank < 4) return false;
        }

        // 3. Timeframe filter
        if (tfFilter !== 'all' && s.timeframe !== tfFilter) return false;

        // 4. Direction filter (Bypass if custom strategy is active)
        if (customFilterId === 'none' && dirFilter !== 'all') {
            const isBuy = (s.confluence_rank || 0) > 0;
            if (dirFilter === 'buy' && !isBuy) return false;
            if (dirFilter === 'sell' && isBuy) return false;
        }

        // 5. Strategy filter (Bypass if custom strategy is active)
        if (customFilterId === 'none' && stratFilter !== 'all' && s.trade_strategy !== stratFilter) return false;

        // 6. Custom Blueprint Strategy Filter
        if (customFilterId !== 'none' && activeScreenerBlueprint) {
            const isMatch = evaluateBlueprintMatch(s, activeScreenerBlueprint);
            if (!isMatch) return false;
        }

        // 6. Target/SL % filters
        const score = s.confluence_rank || 0;
        const price = s.ltp || s.close || 0;
        
        let tVal = s.target;
        let sVal = s.sl;

        if (activeScreenerBlueprint) {
            const b = activeScreenerBlueprint.originalData;
            const bSide = (b.side || "BUY").toUpperCase();
            tVal = resolveLevelQuery(b.target || "", 'TP', price, bSide, s, screenerTfDataMap);
            sVal = resolveLevelQuery(b.sl || "", 'SL', price, bSide, s, screenerTfDataMap);
        }

        const targetVal = tVal || (score > 0 ? price * 1.05 : price * 0.95);
        const slVal = sVal || (score > 0 ? price * 0.97 : price * 1.03);

        const rewardPct = Math.abs((targetVal - price) / price) * 100;
        const riskPct = Math.abs((slVal - price) / price) * 100;

        if (rewardPct < targetMin || rewardPct > targetMax) return false;
        if (riskPct < slMin || riskPct > slMax) return false;

        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:40px; color:var(--text-dim);">No signals found matching your filters in ${currentMode} mode.</td></tr>`;
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

        // --- Dynamic Column Calculation (Match User Requirement) ---
        let strategy = s.trade_strategy || (Math.abs(score) === 5 ? "High Conviction Confluence" : "Trend Support");
        let displayScore = s.pattern_score || 0;
        const metricsTooltip = getMetricsList(s);

        let targets = [];
        let stopLosses = [];
        let accumulations = [{ label: 'Zone', price: price }]; // Standardize as object array

        if (activeScreenerBlueprint) {
            strategy = activeScreenerBlueprint.name;
            const b = activeScreenerBlueprint.originalData;
            const bSide = (b.side || "BUY").toUpperCase();
            
            targets = resolveMultiTarget(b.target || "", 'TP', price, bSide, s, screenerTfDataMap);
            stopLosses = resolveMultiTarget(b.sl || "", 'SL', price, bSide, s, screenerTfDataMap);
            accumulations = resolveMultiTarget(b.accum || "", 'ACCUM', price, bSide, s, screenerTfDataMap);
            
            // If the blueprint matched, ensure we show some positive score indicator if not present
            if (displayScore === 0) displayScore = 5; 
        } else {
            targets = [{ label: 'T1', price: (isBullish ? price * 1.05 : price * 0.95) }];
            stopLosses = [{ label: 'SL', price: (isBullish ? price * 0.97 : price * 1.03) }];
        }

        // Format Multi-Target Display
        const formatLevel = (level, p) => {
            if (!level || typeof level.price !== 'number') return '';
            const diff = level.price - p;
            const pct = p > 0 ? ((Math.abs(diff) / p) * 100).toFixed(1) : "0.0";
            const prefix = diff >= 0 ? '+' : '-';
            const color = diff >= 0 ? 'var(--success)' : 'var(--danger)';
            return `<div style="margin-bottom:4px;">
                <span style="font-size:10px; font-weight:800; opacity:0.6;">${level.label || 'LVL'}:</span> 
                <span style="font-family:'Fira Code', monospace; font-weight:700;">${level.price.toFixed(2)}</span>
                <span style="font-size:10px; color:${color}; font-weight:600;">(${prefix}${pct}%)</span>
            </div>`;
        };

        const targetsDisplay = targets.map(t => formatLevel(t, price)).join('');
        const slDisplay = stopLosses.map(l => formatLevel(l, price)).join('');
        const accumulationHTML = accumulations.map(a => `<div style="font-size:11px; opacity:0.8;">${a.label || 'Zone'}: ${a.price.toFixed(2)}</div>`).join('');

        // Calculate R:R Range
        let rrDisplay = "1:2.0";
        if (targets.length > 0 && stopLosses.length > 0) {
            const minT = targets[0].price;
            const maxT = targets[targets.length - 1].price;
            const sl = stopLosses[0].price;
            
            const risk = Math.max(0.1, Math.abs(price - sl));
            const rewMin = Math.abs(minT - price);
            const rewMax = Math.abs(maxT - price);
            
            const rrMin = (rewMin / risk).toFixed(1);
            const rrMax = (rewMax / risk).toFixed(1);
            rrDisplay = (rrMin === rrMax) ? `1:${rrMin}` : `1:${rrMin} \u279E ${rrMax}`;
        }

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
                    <span class="badge" title="${metricsTooltip}" style="background:${isBullish ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; color:${isBullish ? 'var(--success)' : 'var(--danger)'}; border:1px solid ${isBullish ? 'var(--success)' : 'var(--danger)'}44; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: help;">
                        ${strategy} <i class="fas fa-info-circle" style="font-size: 9px; opacity: 0.7;"></i>
                    </span>
                    <div style="font-size: 10px; color: var(--text-dim); margin-top: 6px;">
                        Risk/Reward: <span style="color: var(--text-main); font-weight: 600;">${rrDisplay}</span>
                    </div>
                </td>
                <td style="color:var(--amber); font-weight:600; font-size:11px;">${accumulationHTML}</td>
                <td style="color:var(--success); font-weight:600; font-size:11px;">${targetsDisplay}</td>
                <td style="color:var(--danger); font-weight:600; font-size:11px;">${slDisplay}</td>
                <td style="text-align: center;">
                    <span class="badge" style="background: rgba(168, 85, 247, 0.1); color: var(--purple); border: 1px solid rgba(168, 85, 247, 0.3); font-weight: 800; padding: 2px 8px;">
                        ${displayScore}
                    </span>
                </td>
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
    "CMP": "LTP",
    "LTP": "LTP",
    "Close": "LTP",
    "SuperTrend": "ST",
    "ST": "ST",
    "SuperTrendValue": "ST_V",
    "ST_V": "ST_V",
    "STV": "ST_V",
    "RSI": "RSI",
    "VOL": "VOL",
    "VOL_R": "VOL_R",
    "BULL_S": "BULL_S",
    "BEAR_S": "BEAR_S",
    "EMA_F": "EMA_F",
    "EMA_S": "EMA_S",
    "EMA_C": "EMA_C",
    "EMA_V": "EMA_V",
    "PE": "pe",
    "PB": "pb",
    "ROE": "roe",
    "EPS": "eps",
    "OPM": "opm",
    "NPM": "npm",
    "Prev_High": "prev_high",
    "Prev_Low": "prev_low",
    "Pattern": "candlestick_pattern",
    "Pattern_Score": "pattern_score",
    "SMA_10": "SMA_10", "SMA_20": "SMA_20", "SMA_50": "SMA_50", "SMA_100": "SMA_100", "SMA_200": "SMA_200",
    "DMA_10": "SMA_10", "DMA_20": "SMA_20", "DMA_50": "SMA_50", "DMA_100": "SMA_100", "DMA_200": "SMA_200"
};

const STRAT_KEYWORDS = [
    // Core Indicators & Tokens
    "ST", "ST_V", "RSI", "LTP", "CMP", "VOL", "VOL_R",
    "EMA_F", "EMA_S", "PE", "PB", "ROE", "EPS", "OPM", "NPM",
    "Prev_High", "Prev_Low", "High", "Low", "Pattern", "Pattern_Score", "Bullish", "Bearish",

    // Timeframes
    "[5m]", "[15m]", "[30m]", "[1h]", "[Daily]", "[Weekly]", "[Monthly]",

    // Commands & Logic
    "AND", "OR", "NOT", "Timeframe =", "BUY", "SELL"
];

const STRAT_INDICATOR_TOKENS = [
    "RSI", "ST_V", "ST", "STV", "SuperTrend", "SuperTrendValue",
    "LTP", "CMP", "High", "Low", "Prev_High", "Prev_Low",
    "EMA_F", "EMA_S", "EMA_V", "EMA_C", "VOL_R", "VOL", "Pattern",
    "Bullish", "Bearish", "PE", "PB", "ROE", "OPM", "NPM", "EPS", "Market_Cap", "Pattern_Score"
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

const handleStrategyInput = (e) => {
    const textarea = e.target;
    const suggestList = document.getElementById('strat-suggestions');
    if (!suggestList) return;

    const value = textarea.value;
    const cursor = textarea.selectionStart;
    const before = value.substring(0, cursor);

    let lastWord = "";
    let isAfterDot = false;

    const lastDotIdx = before.lastIndexOf('.');
    const delimiters = [' ', '\n', '(', '[', ']', '+', '-', '*', '/', '>', '<', '='];
    let lastDelimIdx = -1;
    delimiters.forEach(d => {
        const idx = before.lastIndexOf(d);
        if (idx > lastDelimIdx) lastDelimIdx = idx;
    });

    if (lastDotIdx > lastDelimIdx) {
        isAfterDot = true;
        lastWord = before.substring(lastDotIdx + 1);
    } else if (before.endsWith('[')) {
        lastWord = '[';
    } else {
        const words = before.split(/[\s\n\(\)\[\]\+\-\*\/\>\<\=]+/);
        lastWord = words[words.length - 1];
    }

    if (lastWord.length < 1 && !isAfterDot) {
        suggestList.style.display = 'none';
        return;
    }

    const searchList = isAfterDot ? STRAT_INDICATOR_TOKENS : STRAT_KEYWORDS;
    const matches = searchList.filter(k => k.toLowerCase().startsWith(lastWord.toLowerCase())).slice(0, 10);

    if (matches.length > 0) {
        suggestList.innerHTML = matches.map((m, idx) => `
            <div class="suggest-item" 
                style="padding: 10px 14px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 13px; color: var(--text-main); font-family: 'Fira Code', monospace; display: flex; align-items: center; gap: 10px;" 
                onclick="applyStratSuggestion('${m}', '${textarea.id || ''}', this)"
                onmouseover="this.style.background='rgba(var(--primary-rgb), 0.2)'"
                onmouseout="this.style.background='transparent'">
                <span style="color: var(--primary); font-size: 14px;">◈</span>
                <span style="flex: 1;">${m}</span>
                <span style="font-size: 9px; opacity: 0.4; text-transform: uppercase;">${isAfterDot ? 'Token' : 'Keyword'}</span>
            </div>
        `).join('');

        const rect = textarea.getBoundingClientRect();
        suggestList.style.position = 'fixed';
        suggestList.style.top = `${rect.bottom + 5}px`;
        suggestList.style.left = `${rect.left}px`;
        suggestList.style.width = `${Math.max(rect.width, 200)}px`;
        suggestList.style.display = 'block';
        suggestList.style.zIndex = '100000';

        // Store current active element for applyStratSuggestion fallback
        suggestList.dataset.targetElement = textarea.id || '';
        if (!textarea.id) {
            window._lastStratActive = textarea;
        }
    } else {
        suggestList.style.display = 'none';
    }
};

function setupStrategyAutoSuggest() {
    const suggestList = document.getElementById('strat-suggestions');
    if (!suggestList) return;

    // Use event delegation for dynamic inputs
    document.addEventListener('input', (e) => {
        if (e.target.classList.contains('strategy-textarea')) {
            handleStrategyInput(e);
        }
    });

    document.addEventListener('focusin', (e) => {
        if (e.target.classList.contains('strategy-textarea')) {
            handleStrategyInput(e);
        }
    });

    document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('#strat-suggestions') && !e.target.closest('.strategy-textarea')) {
            setTimeout(() => suggestList.style.display = 'none', 100);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('strategy-textarea')) {
            if ((e.key === 'Tab' || e.key === 'Enter') && suggestList.style.display === 'block') {
                const first = suggestList.querySelector('.suggest-item');
                if (first) {
                    e.preventDefault();
                    first.click();
                }
            }
        }
    });
}

function applyStratSuggestion(word, targetId = null, btn = null) {
    let textarea;
    if (targetId && targetId !== '') {
        textarea = document.getElementById(targetId);
    } else if (window._lastStratActive) {
        textarea = window._lastStratActive;
    } else {
        textarea = document.activeElement;
    }
    if (!textarea || !textarea.classList.contains('strategy-textarea')) return;

    const value = textarea.value;
    const cursor = textarea.selectionStart;
    const before = value.substring(0, cursor);

    const lastDotIdx = before.lastIndexOf('.');
    const delimiters = [' ', '\n', '(', '[', ']', '+', '-', '*', '/', '>', '<', '='];
    let lastDelimIdx = -1;
    delimiters.forEach(d => {
        const idx = before.lastIndexOf(d);
        if (idx > lastDelimIdx) lastDelimIdx = idx;
    });

    let matchStart;
    if (word.startsWith('[') && before.endsWith('[')) {
        // We typed the trigger [ and are now selecting the full [TF]
        matchStart = before.lastIndexOf('[');
    } else if (lastDotIdx > lastDelimIdx) {
        // Appending indicator after dot
        matchStart = lastDotIdx + 1;
    } else {
        // Replaying after a space/bracket or start of line
        matchStart = lastDelimIdx + 1;
    }

    const newValue = value.substring(0, matchStart) + word + value.substring(cursor);
    textarea.value = newValue;

    const newPos = matchStart + word.length;
    textarea.setSelectionRange(newPos, newPos);
    textarea.focus();

    document.getElementById('strat-suggestions').style.display = 'none';
    updateStrategyExplainer();
}

function clearStrategyLab() {
    currentStrategyId = null;
    ['strat-id-select', 'strat-name', 'strat-entry-query', 'strat-exit-query', 'strat-target-query', 'strat-sl-query', 'strat-accum-query'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    const updateBtn = document.getElementById('btn-update-strat');
    if (updateBtn) updateBtn.style.display = 'none';
    updateStrategyExplainer();
}

function loadSampleQuery(type) {
    const samples = {
        'bullish_dip': {
            name: "Institutional Dip Buyer",
            side: "BUY", tf: "Daily", universe: "swing",
            entry: "[Daily].RSI < 40 AND [Daily].Pattern == 'Bullish'",
            target: "2.5% OR Price > [Daily].prev_high",
            sl: "[Daily].ST_V - 0.5%",
            exit: "[Daily].ST == 'SELL'",
            accum: "Add 50% if [1h].RSI > 50"
        },
        'momentum_breakout': {
            name: "Hyper Momentum Scan",
            side: "BUY", tf: "15m", universe: "swing",
            entry: "Price > [Daily].prev_high AND [1h].VOL == 'BULL_S' AND [15m].EMA_F > [15m].EMA_S",
            target: "1.5% OR Price > [1h].prev_high",
            sl: "[15m].EMA_S",
            exit: "[15m].RSI > 80",
            accum: "Pyramid 25% if [5m].VOL == 'BULL_S'"
        },
        'tf_convergence': {
            name: "M-TF Trend Convergence",
            side: "BUY", tf: "1h", universe: "swing",
            entry: "[Daily].ST == 'BUY' AND [1h].ST == 'BUY' AND [15m].ST == 'BUY'",
            target: "3.5% OR [Daily].prev_high",
            sl: "[1h].ST_V - 0.3%",
            exit: "[15m].ST == 'SELL'",
            accum: "Add 100% if Price > [Daily].EMA_F"
        },
        'bearish_rejection': {
            name: "Bearish Mean Reversion",
            side: "SELL", tf: "Daily", universe: "swing",
            entry: "[Daily].RSI > 75 AND [Daily].Pattern == 'Bearish' AND [1h].ST == 'SELL'",
            target: "2.0% OR Price < [1h].prev_low",
            sl: "[Daily].High",
            exit: "[1h].RSI < 30",
            accum: ""
        },
        'fundamental_breakout': {
            name: "Growth Value Breakout",
            side: "BUY", tf: "Daily", universe: "swing",
            entry: "ROE > 18 AND PE < 35 AND [Daily].ST == 'BUY' AND [Daily].VOL_R > 1.5",
            target: "10.0% OR 25%_Trailing",
            sl: "[Daily].ST_V - 1%",
            exit: "[Daily].ST == 'SELL'",
            accum: "Accumulate 25% every 5% dip"
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

        const tfEl = document.getElementById('strat-timeframe');
        if (tfEl) {
            const options = Array.from(tfEl.options).map(o => o.value);
            if (options.includes(s.tf)) {
                tfEl.value = s.tf;
            } else {
                tfEl.selectedIndex = 0;
            }
        }

        // Synchronize to Visual Builder if it's the current active mode
        if (currentEditorMode === 'visual') {
            ['entry', 'exit', 'target', 'sl', 'accum'].forEach(section => {
                syncQueryToVisual(section);
            });
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

    if (explanation.length === 0) {
        explanation.push("• Scan for stocks matching defined criteria.");
    }

    return explanation;
}

/**
 * Generates human readable explanation for Target and SL queries
 */
function generateLevelExplanation(query, type, side) {
    const q = query.trim();
    if (!q) return type === 'TP' ? "Default profit target (+1.5%)" : "Default risk floor (-1.5%)";

    let base = "Price (LTP)";
    let adjustment = "";

    // 1. Identify Token
    const tokenMatch = q.match(/\[(.*?)\]\.(HIGH|LOW|PREV_HIGH|PREV_LOW|ST_V|ST|SUPERTRENDVALUE|EMA_F|EMA_S)/i);
    if (tokenMatch) {
        const tf = tokenMatch[1];
        const ind = tokenMatch[2].toUpperCase();
        let name = "Indicator";
        if (ind.includes('ST')) name = "SuperTrend Value";
        else if (ind === 'EMA_F') name = "Fast EMA";
        else if (ind === 'EMA_S') name = "Slow EMA";
        else if (ind.includes('HIGH')) name = "Prev Day High";
        else if (ind.includes('LOW')) name = "Prev Day Low";

        base = `<b>${name}</b> on <b>${tf}</b>`;
    }

    // 2. Identify Arithmetic
    const arthMatch = q.match(/([\+\-])\s*(\d+\.?\d*)\s*%/);
    if (arthMatch) {
        adjustment = `, adjusted by <b>${arthMatch[1]}${arthMatch[2]}%</b>`;
    }

    // 3. Pure Percentage
    const pctMatch = q.match(/^(\d+\.?\d*)\s*%$/);
    if (pctMatch && !tokenMatch) {
        return `Set exit at <b>${pctMatch[1]}%</b> from entry cost.`;
    }

    const action = type === 'TP' ? "Take profit" : "Cut loss";
    return `${action} at ${base}${adjustment}.`;
}

function updateStrategyExplainer() {
    const entry = document.getElementById('strat-entry-query').value;
    const target = document.getElementById('strat-target-query').value;
    const sl = document.getElementById('strat-sl-query').value;
    const exit = document.getElementById('strat-exit-query').value;
    const accum = document.getElementById('strat-accum-query').value;
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
    const targetExp = generateLevelExplanation(target, 'TP', side);
    const slExp = generateLevelExplanation(sl, 'SL', side);
    const exitTrans = exit ? translateUserQuery(exit, side, tf) : null;
    const exitExp = exitTrans ? generatePlainEnglish(exitTrans) : ["No condition set"];
    const accumTrans = accum ? translateUserQuery(accum, side, tf) : null;
    const accumExp = accumTrans ? generatePlainEnglish(accumTrans) : ["No condition set"];

    explainerEl.innerHTML = `
        <div style="font-weight: 800; color: ${side === 'BUY' ? 'var(--success)' : 'var(--danger)'}; margin-bottom: 20px; font-size: 15px;">
            PLAN: ${side} @ ${tf}
        </div>
        <div style="display: flex; flex-direction: column; gap: 12px;">
            <div style="padding: 10px; background: rgba(var(--success-rgb), 0.05); border-left: 3px solid var(--success); border-radius: 4px;">
                <span style="font-size: 10px; font-weight: 800; opacity: 0.6; display: block; margin-bottom: 6px; letter-spacing: 0.5px;">1. ENTRY LOGIC</span>
                <div style="font-size: 13px;">${explanation.join('<br>')}</div>
            </div>
            <div style="padding: 10px; background: rgba(var(--amber-rgb), 0.05); border-left: 3px solid var(--amber); border-radius: 4px;">
                <span style="font-size: 10px; font-weight: 800; opacity: 0.6; display: block; margin-bottom: 6px; letter-spacing: 0.5px;">2. TARGET LOGIC</span>
                <div style="font-size: 13px;">• ${targetExp}</div>
            </div>
            <div style="padding: 10px; background: rgba(var(--primary-rgb), 0.05); border-left: 3px solid var(--primary); border-radius: 4px;">
                <span style="font-size: 10px; font-weight: 800; opacity: 0.6; display: block; margin-bottom: 6px; letter-spacing: 0.5px;">3. EXIT CONDITION</span>
                <div style="font-size: 13px;">${exitExp.join('<br>')}</div>
            </div>
            <div style="padding: 10px; background: rgba(var(--danger-rgb), 0.05); border-left: 3px solid var(--danger); border-radius: 4px;">
                <span style="font-size: 10px; font-weight: 800; opacity: 0.6; display: block; margin-bottom: 6px; letter-spacing: 0.5px;">4. STOP LOGIC</span>
                <div style="font-size: 13px;">• ${slExp}</div>
            </div>
            ${accum ? `<div style="padding: 10px; background: rgba(var(--purple-rgb), 0.05); border-left: 3px solid var(--purple); border-radius: 4px;">
                <span style="font-size: 10px; font-weight: 800; opacity: 0.6; display: block; margin-bottom: 6px; letter-spacing: 0.5px;">5. ACCUMULATION LOGIC</span>
                <div style="font-size: 13px;">${accumExp.join('<br>')}</div>
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

/**
 * Handle Blueprint Selection from Dropdown
 */
function onStratSelectChange() {
    const sel = document.getElementById('strat-id-select');
    if (!sel.value) {
        clearStrategyLab();
        return;
    }
    const [data, id, name] = sel.value.split('|');
    loadSavedStrategyLogic(data, id, name);
}

async function saveCurrentStrategy(updateExisting = false) {
    const name = document.getElementById('strat-name').value || "Unnamed Strategy";
    const entry = document.getElementById('strat-entry-query').value;
    const target = document.getElementById('strat-target-query').value;
    const sl = document.getElementById('strat-sl-query').value;
    const exit = document.getElementById('strat-exit-query').value;
    const accum = document.getElementById('strat-accum-query').value;

    const side = document.getElementById('strat-side').value;
    const tf = document.getElementById('strat-timeframe').value;
    const universe = currentMode; 

    if (!entry) return alert("Please enter Entry Criteria.");

    const structuredData = {
        entry, target, sl, exit, accum, side, tf, universe, version: "3.0"
    };

    const finalId = updateExisting ? currentStrategyId : null;

    const payload = {
        id: finalId, 
        name,
        query: JSON.stringify(structuredData),
        mode: universe,
        timeframe: tf
    };

    try {
        const res = await fetch('/api/strategies/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.status === 'success') {
            showToast(finalId ? `Profile '${name}' Updated.` : "New Strategy Profile Saved.", "success");
            renderSavedStrategies(); 
        } else {
            showToast("Failed to save strategy.", "error");
        }
    } catch (e) {
        console.error("Save Error:", e);
        showToast("Storage Error.", "error");
    }
}

function loadSavedStrategyLogic(base64Data, id = null, name = null) {
    try {
        currentStrategyId = id;
        const updateBtn = document.getElementById('btn-update-strat');
        if (updateBtn) updateBtn.style.display = id ? 'inline-block' : 'none';

        if (name) {
            const nameEl = document.getElementById('strat-name');
            if (nameEl) nameEl.value = name;
        }

        const sel = document.getElementById('strat-id-select');
        if (sel && id) {
            for (let opt of sel.options) {
                if (opt.value.includes(`|${id}|`)) {
                    sel.value = opt.value;
                    break;
                }
            }
        }

        const raw = atob(base64Data);
        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
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
            showToast("Legacy blueprint loaded.", "info");
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

        showToast("Blueprint Loaded.", "success");
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

        // 1. Update Dropdown in Editor
        const sel = document.getElementById('strat-id-select');
        if (sel) {
            const currentVal = sel.value;
            sel.innerHTML = '<option value="">+ New Blueprint</option>';
            saved.forEach(s => {
                const opt = document.createElement('option');
                opt.value = `${btoa(s.query)}|${s.id}|${s.name}`;
                opt.innerText = s.name;
                sel.appendChild(opt);
            });
            // Try to restore selection if we were just updating
            if (currentStrategyId) {
                for (let opt of sel.options) {
                    if (opt.value.includes(`|${currentStrategyId}|`)) {
                        sel.value = opt.value;
                        break;
                    }
                }
            }
        }

        // 2. Update Sidebar List
        list.innerHTML = saved.map(s => {
            const isSwing = s.mode === 'swing';
            const tfBadge = s.timeframe ? `<span class="badge ${isSwing ? 'bg-blue-trans' : 'bg-amber-trans'}" style="font-size:9px; padding: 2px 6px; margin-left: 8px;">${s.mode.toUpperCase()} (${s.timeframe})</span>` : '';
            return `
                <div class="saved-strat-item" onclick="loadSavedStrategyLogic('${btoa(s.query)}', ${s.id}, '${s.name}')" 
                    style="background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border: 1px solid transparent; transition: all 0.2s; margin-bottom: 6px;">
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        <div style="font-size: 13px; font-weight: 700; color: var(--text-main); display: flex; align-items: center;">
                            ${s.name} ${tfBadge}
                        </div>
                        <div style="font-size: 10px; opacity: 0.5;">Last Mod: ${new Date(s.updated_at).toLocaleDateString()}</div>
                    </div>
                    <button class="btn btn-icon" onclick="event.stopPropagation(); deleteStrategyFromServer(${s.id})" style="color: var(--danger); opacity: 0.5;"><i class="fas fa-trash"></i></button>
                </div>
            `;
        }).join('');

        // Refresh Screener dropdown as well so they stay in sync
        populateScreenerBlueprints();
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

    // Show processing state instantly
    if (resultsGrid) {
        resultsGrid.innerHTML = '<tr><td colspan="10"><div class="skeleton-box" style="margin:20px 0;"></div><div class="skeleton-box" style="margin:20px 0;width:80%;"></div><div class="skeleton-box" style="margin:20px 0;width:90%;"></div></td></tr>';
    }

    if (tableControllers.lab) tableControllers.lab.abort();
    tableControllers.lab = new AbortController();

    try {
        // 2. Parse Timeframes from the translated query AND the Target/SL boxes
        // Space-tolerant regex for [TF] or {TF}
        const tfRegex = /[\[\{]\s*(.*?)\s*[\]\}]/g;
        let match;
        const usedTfs = [];

        // Scan the translated entry logic
        while ((match = tfRegex.exec(query)) !== null) {
            usedTfs.push(match[1]);
        }

        // ALSO scan the raw Target and SL logic boxes for extra timeframes
        const targetRaw = document.getElementById('strat-target-query').value;
        const slRaw = document.getElementById('strat-sl-query').value;

        [targetRaw, slRaw].forEach(q => {
            let m;
            const re = /\[(.*?)\]/g;
            while ((m = re.exec(q)) !== null) {
                usedTfs.push(m[1]);
            }
        });

        if (usedTfs.length === 0) {
            usedTfs.push(defaultTf);
        }

        // 3. Fetch Data for all required timeframes
        const tfDataMap = {};
        await Promise.all([...new Set(usedTfs)].map(async (tf) => {
            // Case-insensitive lookup in TF_MAP
            const normalizedTf = Object.keys(TF_MAP).find(k => k.toLowerCase() === tf.toLowerCase());
            const apiTf = normalizedTf ? TF_MAP[normalizedTf] : tf;

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
            'prev_low': 'prev_low',
            'Pattern': 'candlestick_pattern',
            'Pattern_Score': 'pattern_score'
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

        // 5. Token Resolution: Handle spaces and brackets/braces
        // Matches [TF].VAR or {TF}.VAR or [TF] . VAR etc
        const tokenRegex = /[\[\{]\s*(.*?)\s*[\]\}]\s*\.\s*([A-Z_a-z0-9]+)/g;
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

                const key = indMap[token.attr] || token.attr;
                let val = s[key];
                
                // --- DMA/SMA Lookup Fix (also handle lowercase fallbacks) ---
                if (val === undefined || val === null) {
                    // Try case-insensitive fallback on the object itself first
                    const lowerKey = Object.keys(s).find(k => k.toLowerCase() === token.attr.toLowerCase());
                    if (lowerKey) val = s[lowerKey];
                    
                    if ((val === undefined || val === null) && s.dma_data) {
                        const dmaKey = Object.keys(s.dma_data).find(k => k.toLowerCase() === token.attr.toLowerCase());
                        if (dmaKey) val = s.dma_data[dmaKey];
                    }
                }
                // --- End Fix ---

                if (token.attr === 'volume_signal' || key === 'volume_signal') {
                    val = val === 'BULL_SPIKE' ? "'BULL_S'" : (val === 'BEAR_SPIKE' ? "'BEAR_S'" : "'NONE'");
                } else if (token.attr === 'candlestick_pattern' || key === 'candlestick_pattern') {
                    // Simplified sentiment matching
                    if (val && val.includes('Bullish')) val = "'Bullish'";
                    else if (val && val.includes('Bearish')) val = "'Bearish'";
                    else val = "'None'";
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
    const accumQuery = document.getElementById('strat-accum-query').value;

    return {
        targets: resolveMultiTarget(targetQuery, 'TP', ltp, side, stock, tfDataMap),
        stopLosses: resolveMultiTarget(slQuery, 'SL', ltp, side, stock, tfDataMap),
        accumulations: resolveMultiTarget(accumQuery, 'ACCUM', ltp, side, stock, tfDataMap)
    };
}

function forecastPriceFromRSI(targetRSI, currentPrice, currentRSI, isBuyTime = true) {
    if (isNaN(targetRSI) || isNaN(currentRSI) || isNaN(currentPrice)) return currentPrice;
    
    // RSI Formula: 100 - (100 / (1 + RS))
    // RS = AvgGain / AvgLoss
    // AvgGain = RS * AvgLoss
    
    // We don't have AvgGain/Loss history here, so we approximate it
    // Assumption: Standard 14-period Wilder's Smoothing
    const period = 14;
    
    // 1. Convert RSI to RS
    const K = currentRSI / (100 - currentRSI);
    const T = targetRSI / (100 - targetRSI);
    
    // 2. Estimate current AvgGain and AvgLoss by assuming a standard Volatility range
    // Heuristic: Median daily range ~ 1.2%
    const estimatedVolatility = currentPrice * 0.012; 
    const avgLoss = estimatedVolatility / (K + 1);
    const avgGain = estimatedVolatility - avgLoss;

    // 3. Solve for NextGain or NextLoss to hit target RSI T
    // (AvgGain * (N-1) + NextGain) / (AvgLoss * (N-1) + NextLoss) = T
    // Assuming NextLoss = 0 if target > current, NextGain = 0 if target < current
    let nextMove = 0;
    if (targetRSI > currentRSI) {
        // Solving for NextGain:
        nextMove = T * (avgLoss * (period - 1)) - (avgGain * (period - 1));
    } else {
        // Solving for NextLoss:
        nextMove = ( (avgGain * (period - 1)) / T ) - (avgLoss * (period - 1));
        nextMove = -nextMove; // It's a price drop
    }

    return currentPrice + nextMove;
}

/**
 * Handles multiple Targets/SLs separated by OR / |
 */
function resolveMultiTarget(query, type, ltp, side, stock, tfDataMap) {
    const raw = (query || "").trim();
    if (!raw) return [{ label: type === 'TP' ? 'T1' : 'SL', price: resolveLevelQuery("", type, ltp, side, stock, tfDataMap) }];
    
    const parts = raw.split(/\|| OR /i);
    return parts.map((q, idx) => {
        const label = parts.length > 1 ? `${type === 'TP' ? 'T' : 'S'}${idx + 1}` : (type === 'TP' ? 'T1' : 'SL');
        return {
            label: label,
            price: resolveLevelQuery(q.trim(), type, ltp, side, stock, tfDataMap)
        };
    });
}

/**
 * Universal Price Resolver for Strategy Logic
 * Handles Percentages, Indicators [TF].KEY, Arithmetic Offset, and Inverse RSI
 */
function resolveLevelQuery(query, type, ltp, side, stock, tfDataMap) {
    let q = (query || "").trim();
    if (!q) {
        if (type === 'TP') return ltp * (side === 'BUY' ? 1.015 : 0.985);
        if (type === 'SL') return ltp * (side === 'BUY' ? 0.985 : 1.015);
        return ltp;
    }

    let baseValue = ltp;
    let isToken = false;

    // 0. Pre-process Shorthands (Assuming base timeframe if not provided)
    // Handle @High, @Low shorthands
    q = q.replace(/@High/gi, `[Current].Prev_High`);
    q = q.replace(/@Low/gi, `[Current].Prev_Low`);
    
    // Auto-bracket indicators that are sitting alone
    // e.g. "RSI + 2%" -> "[Current].RSI + 2%"
    Object.keys(STRAT_ALIASES).sort((a,b)=>b.length-a.length).forEach(alias => {
        const regex = new RegExp(`(?<!\\[|\\.)\\b${alias}\\b`, 'gi');
        if (q.match(regex) && !q.includes('[')) {
            q = q.replace(regex, `[Current].${alias}`);
        }
    });

    // 1. Identify Token and Base Price
    // Pattern: [Timeframe].Indicator or {Timeframe}.Indicator
    const tokenRegex = /[\[\{\(](.*?)[\]\}\)]\s*\.\s*(\w+)/i;
    const tokenMatch = q.match(tokenRegex);
    
    if (tokenMatch) {
        let tfKey = tokenMatch[1].trim();
        if (tfKey.toLowerCase() === 'current') {
            // Use the timeframe of the stock record itself
            const recordTf = (stock.timeframe || currentTimeframe);
            tfKey = recordTf;
        }

        const indicatorInput = tokenMatch[2].trim();
        const indicatorKey = STRAT_ALIASES[indicatorInput] || indicatorInput.toUpperCase();
        
        // Lookup data in map, trying both normalized and raw names
        const normalizedTf = Object.keys(TF_MAP).find(k => k.toLowerCase() === tfKey.toLowerCase());
        const apiTf = normalizedTf ? TF_MAP[normalizedTf] : tfKey;
        
        // Search in the map using any possible key
        const tfData = tfDataMap[tfKey] || tfDataMap[apiTf] || tfDataMap[normalizedTf] || [];
        const s = tfData.find(item => item.isin === stock.isin);

        if (s) {
            isToken = true;
            const mappedInd = {
                'ST_V': 'supertrend_value', 'ST': 'supertrend_value', 'SUPERTRENDVALUE': 'supertrend_value',
                'EMA_F': 'ema_fast', 'EMA_S': 'ema_slow', 'EMA_V': 'ema_value',
                'RSI': 'rsi', 'LTP': 'ltp', 'PRICE': 'ltp', 'CLOSE': 'ltp',
                'PREV_HIGH': 'prev_high', 'HIGH': 'prev_high',
                'PREV_LOW': 'prev_low', 'LOW': 'prev_low',
                'roe': 'roe', 'pe': 'pe', 'eps': 'eps'
            };
            const col = mappedInd[indicatorKey.toUpperCase()] || indicatorKey.toLowerCase();
            baseValue = s[col] !== undefined && s[col] !== null ? s[col] : ltp;
        }
    }

    // 2. Handle Arithmetic Adjustment (e.g. - 0.5% or + 10)
    // Matches: + 5%, - 2, + 1.5, etc.
    const arithmeticMatch = q.match(/([\+\-])\s*(\d+\.?\d*)\s*(%?)/);
    if (arithmeticMatch) {
        const op = arithmeticMatch[1];
        const val = parseFloat(arithmeticMatch[2]);
        const isPct = arithmeticMatch[3] === '%';
        const startVal = parseFloat(baseValue) || ltp;

        if (isPct) {
            const pct = val / 100;
            return op === '+' ? startVal * (1 + pct) : startVal * (1 - pct);
        } else {
            return op === '+' ? startVal + val : startVal - val;
        }
    }

    // 3. Standalone Percentage (e.g. 5%)
    const purePctMatch = q.match(/^(\+|-)?\s*(\d+\.?\d*)\s*%$/);
    if (purePctMatch && !isToken) {
        const pct = parseFloat(purePctMatch[2]) / 100;
        const op = purePctMatch[1] || ""; // Handle "+5%" or "-5%"
        const isBuy = side.toUpperCase() === 'BUY';
        
        if (op === "+") return ltp * (1 + pct);
        if (op === "-") return ltp * (1 - pct);
        
        // Context-aware fallback if no sign provided
        if (type === 'TP') return isBuy ? ltp * (1 + pct) : ltp * (1 - pct);
        if (type === 'SL') return isBuy ? ltp * (1 - pct) : ltp * (1 + pct);
        return ltp;
    }

    // 5. Inverse RSI Solver (e.g. RSI[70] or RSI > 70)
    const rsiMatch = q.match(/RSI\s*(?:\s*[\[\(]\s*(\d+\.?\d*)\s*[\]\)]|[><=]+\s*(\d+\.?\d*))/i);
    if (rsiMatch) {
        const targetRSI = parseFloat(rsiMatch[1] || rsiMatch[2]);
        const currentRSI = stock.rsi || 50;
        return forecastPriceFromRSI(targetRSI, ltp, currentRSI, side.toUpperCase() === 'BUY');
    }

    // Safety: If someone just put "RSI" alone in a price box, it's probably a mistake.
    // We should either return current price or an Inverse RSI default.
    // But since it's already pre-processed to [Current].RSI, it won't hit the standalone number logic.
    // However, if isToken is true and the indicator is RSI/PE/PB, we should warn or handle.
    if (isToken) {
        // Indicators that are usually < 100 (Momentum/Ratio) should NOT be raw prices
        const momentumInds = ['RSI', 'PE', 'ROE', 'PB', 'NPM', 'OPM'];
        const indName = q.split('.').pop().toUpperCase();
        if (momentumInds.includes(indName) && !q.includes('RSI')) {
             return ltp; // Ignore raw score as price
        }
    }

    return parseFloat(baseValue) || ltp;
}

// Strategy Lab Sorting & Export
let lastStrategySortColumn = 'symbol';
let lastStrategySortDirection = 'asc';

function sortStrategyResults(column) {
    if (lastStrategySortColumn === column) {
        lastStrategySortDirection = lastStrategySortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        lastStrategySortColumn = column;
        lastStrategySortDirection = 'desc';
    }

    if (!lastScanMatches || !lastScanMatches.length) return;

    const sorted = [...lastScanMatches].sort((a, b) => {
        let v1 = a[column];
        let v2 = b[column];

        // Handle nested or computed objects if necessary
        if (column === 'i_group') v1 = a.i_group || a.industry || '';
        if (column === 'i_group') v2 = b.i_group || b.industry || '';

        // Type-specific comparison
        if (typeof v1 === 'string') {
            return lastStrategySortDirection === 'asc'
                ? v1.localeCompare(v2)
                : v2.localeCompare(v1);
        } else {
            return lastStrategySortDirection === 'asc' ? v1 - v2 : v2 - v1;
        }
    });

    renderScanResults(sorted, true);
}

function exportStrategyToExcel() {
    if (!lastScanMatches || !lastScanMatches.length) return alert("No scan results to export.");

    const headers = ["Symbol", "ISIN", "LTP", "Industry", "Sub-Group", "RSI", "PE", "Score", "Side", "Targets", "Tgt %", "Stop Loss", "SL %"];
    const rows = lastScanMatches.map(s => {
        return [
            s.symbol,
            s.isin,
            s.ltp,
            s.i_group || '-',
            s.i_subgroup || '-',
            (s.rsi || 0).toFixed(1),
            (s.pe || 0).toFixed(2),
            s.pattern_score || 0,
            s.side,
            s.levels.targets.map(t => t.price.toFixed(2)).join(" | "),
            s.levels.targets.map(t => ((t.price - s.ltp) / s.ltp * 100).toFixed(1) + "%").join(" | "),
            s.levels.stopLosses.map(t => t.price.toFixed(2)).join(" | "),
            s.levels.stopLosses.map(t => ((t.price - s.ltp) / s.ltp * 100).toFixed(1) + "%").join(" | ")
        ];
    });

    const csvContent = [
        headers.join(","),
        ...rows.map(e => e.join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Strategy_Scan_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Helper function for currency formatting (assuming it's not globally defined)
function formatCurrency(value) {
    return parseFloat(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderScanResults(matches, isFilter = false) {
    const grid = document.getElementById('strat-results-grid');
    if (!isFilter) lastScanMatches = matches;

    if (!matches.length) {
        grid.innerHTML = `<tr><td colspan="13" style="padding: 100px; text-align:center; opacity: 0.3;">
            <i class="fas fa-ghost fa-3x" style="margin-bottom:20px;"></i>
            <p style="font-size:14px;">No matching symbols found in current scan.</p>
        </td></tr>`;
        return;
    }

    grid.innerHTML = matches.map(s => {
        const sideColor = s.side === 'BUY' ? 'var(--success)' : 'var(--danger)';
        const ltpVal = formatCurrency(s.ltp);

        // Multi-Target Format for Grid
        const formatMiniLevel = (levels, p) => {
            return levels.map(l => {
                const diff = l.price - p;
                const pct = ((Math.abs(diff) / p) * 100).toFixed(1);
                const prefix = diff >= 0 ? '+' : '-';
                const color = diff >= 0 ? 'var(--success)' : 'var(--danger)';
                return `<div style="margin-bottom:4px; display: flex; flex-direction: column; align-items: flex-end;">
                    <div style="font-family:'Fira Code', monospace; font-weight:700; font-size:12px; color: ${color};">${formatCurrency(l.price)}</div>
                    <div style="font-size:9px; opacity: 0.6; font-weight:600;">${l.label} (${prefix}${pct}%)</div>
                </div>`;
            }).join('');
        };

        const targetHTML = formatMiniLevel(s.levels.targets, s.ltp);
        const slHTML = formatMiniLevel(s.levels.stopLosses, s.ltp);

        // Industry & Subgroup
        const industryHtml = `
            <div style="font-size: 13px; color: var(--text-main); font-weight: 500; overflow: hidden; text-overflow: ellipsis; max-width: 140px;" title="${s.i_group || '-'}">${s.i_group || '-'}</div>
            <div style="font-size: 10px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; max-width: 140px; margin-top: 2px;" title="${s.i_subgroup || '-'}">${s.i_subgroup || '-'}</div>
        `;

        const rsi = s.rsi ? s.rsi.toFixed(1) : '-';
        const pe = s.pe ? s.pe.toFixed(2) : '-';
        const score = s.pattern_score || 0;
        const scoreColor = score > 0 ? 'var(--success)' : (score < 0 ? 'var(--danger)' : 'var(--text-dim)');

        // Sparkline logic (Formation)
        let sparklineHtml = '-';
        let l5_data = s.last_5_candles;
        if (typeof l5_data === 'string' && l5_data.trim()) {
            try { l5_data = JSON.parse(l5_data); } catch (e) { }
        }
        if (Array.isArray(l5_data) && l5_data.length > 0) {
            const rawDataJson = encodeURIComponent(JSON.stringify(l5_data));
            let minLow = Infinity;
            let maxHigh = -Infinity;
            l5_data.forEach(c => {
                if (c.l < minLow) minLow = c.l;
                if (c.h > maxHigh) maxHigh = c.h;
            });
            let range = maxHigh - minLow;
            if (range === 0) range = maxHigh * 0.01 || 1;

            const svgHeight = 28;
            const candleWidth = 8;
            const gap = 4;
            const svgWidth = (candleWidth * 5) + (gap * 4);
            const pad = 2;
            const usableHeight = svgHeight - (pad * 2);
            const patternLabel = s.candlestick_pattern || '';

            let svgContent = `<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" style="cursor: pointer;" onclick="showCandlesPopup('${s.isin}', '${s.symbol}', ${s.ltp}, this.dataset.pattern, this.dataset.candles)" data-candles="${rawDataJson}" data-pattern="${patternLabel}">`;

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
                let bodyHeight = Math.max(1, bottomBody - topBody);

                svgContent += `<line x1="${xCenter}" y1="${yHigh}" x2="${xCenter}" y2="${yLow}" stroke="${color}" stroke-width="1.2" shape-rendering="crispEdges"/>`;
                svgContent += `<rect x="${xCenter - candleWidth / 2}" y="${topBody}" width="${candleWidth}" height="${bodyHeight}" fill="${color}" shape-rendering="crispEdges"/>`;
            });
            svgContent += `</svg>`;

            sparklineHtml = `
                <div style="background: rgba(14, 21, 31, 0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 4px; padding: 4px 6px; display: inline-block;">
                    ${svgContent}
                </div>`;
        }

        return `
            <tr class="strat-card" data-isin="${s.isin}" style="border-bottom: 1px solid rgba(255,255,255,0.02);">
                <td style="padding: 15px 20px;">
                    <div style="font-weight: 700; color: var(--text-main);" class="symbol-name">${s.symbol}</div>
                    <div style="font-size: 10px; opacity: 0.5;">${s.isin}</div>
                </td>
                <td style="padding: 15px 20px; text-align: right; font-weight: 800; color: var(--amber);" class="ltp-val">
                    ${ltpVal}
                </td>
                <td style="padding: 15px 20px; text-align: left;">
                    ${industryHtml}
                </td>
                <td style="padding: 15px 20px; text-align: right; font-weight: 600; color: var(--primary);">
                    ${rsi}
                </td>
                <td style="padding: 15px 20px; text-align: right; font-weight: 600; color: var(--text-main);">
                    ${pe}
                </td>
                <td style="padding: 15px 20px; text-align: right; font-weight: 700; color: ${scoreColor};">
                    ${score > 0 ? '+' : ''}${score}
                </td>
                <td style="padding: 15px 20px; text-align: center;">
                    ${sparklineHtml}
                </td>
                <td style="padding: 15px 20px; text-align: center;">
                    <span class="badge" style="background: ${sideColor}20; color: ${sideColor}; border: 1px solid ${sideColor}40; font-weight: 800; padding: 2px 8px;">
                        ${s.side}
                    </span>
                </td>
                <td colspan="2" style="padding: 15px 20px; text-align: right; vertical-align: top;">
                    ${targetHTML}
                </td>
                <td colspan="2" style="padding: 15px 20px; text-align: right; vertical-align: top;">
                    ${slHTML}
                </td>
                <td style="padding: 15px 20px; text-align: center;">
                    <div style="display: flex; gap: 8px; justify-content: center;">
                        <button class="btn btn-primary" style="height: 32px; padding: 0 12px; font-size: 11px;" 
                            onclick="commitToTrade('${s.isin}', ${s.levels.targets[0].price}, ${s.levels.stopLosses[0].price})">
                            <i class="fas fa-bolt"></i> Trade
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

    const qty = prompt(`Enter quantity for confluence-validated ${side} trade in ${symbol} at ${ltp}:`, "100");
    if (!qty || isNaN(qty)) return;

    const payload = {
        isin: isin,
        symbol: symbol,
        mode: currentMode, // UI element is missing, using current app mode
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

// --- Visual Strategy Builder Functions ---

let strategyEditorMode = 'query';

function setGlobalEditorMode(mode) {
    strategyEditorMode = mode;
    const sections = ['entry', 'exit', 'target', 'sl', 'accum'];
    const queryBtn = document.getElementById('btn-global-query');
    const visualBtn = document.getElementById('btn-global-visual');

    if (mode === 'query') {
        queryBtn.classList.add('active');
        visualBtn.classList.remove('active');
        sections.forEach(s => {
            const containerQ = document.getElementById(`container-${s}-query`);
            const containerV = document.getElementById(`container-${s}-visual`);
            if (containerQ && containerV) {
                // Sync Visual to Query before switching to Query mode
                syncVisualToQuery(s);
                containerQ.classList.remove('hidden');
                containerV.classList.add('hidden');
            }
        });
    } else {
        visualBtn.classList.add('active');
        queryBtn.classList.remove('active');
        sections.forEach(s => {
            const containerQ = document.getElementById(`container-${s}-query`);
            const containerV = document.getElementById(`container-${s}-visual`);
            if (containerQ && containerV) {
                // Sync Query to Visual before switching to Visual mode
                syncQueryToVisual(s);
                containerQ.classList.add('hidden');
                containerV.classList.remove('hidden');
            }
        });
    }
}

function addVisualRule(section, data = null) {
    const rulesContainer = document.getElementById(`${section}-visual-rules`);
    if (!rulesContainer) return;

    const rowCount = rulesContainer.querySelectorAll('.visual-rule-row').length;
    const row = document.createElement('div');
    row.className = 'visual-rule-row';

    // OR condition support: Add AND/OR dropdown for rows after the first
    const logicHtml = rowCount === 0 ?
        `<div class="rule-logic" style="color:var(--text-dim); font-size: 10px; text-align: center;">IF</div>` :
        `<select class="select-input rule-logic-op" style="color:var(--amber); font-weight:800; background:rgba(217,119,6,0.1);">
            <option value="AND">AND</option>
            <option value="OR">OR</option>
         </select>`;

    row.innerHTML = `
        ${logicHtml}
        <select class="select-input rule-tf">
            <option value="[Daily]">[Daily]</option>
            <option value="[Weekly]">[Weekly]</option>
            <option value="[Monthly]">[Monthly]</option>
            <option value="[1h]">[1h]</option>
            <option value="[15m]">[15m]</option>
            <option value="[5m]">[5m]</option>
        </select>
        <select class="select-input rule-ind">
            <option value="RSI">RSI</option>
            <option value="LTP">Price (LTP)</option>
            <option value="EMA_F">Fast EMA</option>
            <option value="EMA_S">Slow EMA</option>
            <option value="ST_V">SuperTrend</option>
            <option value="ATR">ATR</option>
            <option value="Volume">Volume</option>
            <option value="Pattern">Pattern</option>
            <option value="Pattern_Score">Pattern Score</option>
        </select>
        <select class="select-input rule-op">
            <option value="<"><</option>
            <option value=">">></option>
            <option value="==">==</option>
            <option value="!=">!=</option>
            <option value=">=">>=</option>
            <option value="<="><=</option>
        </select>
        <input type="text" class="select-input rule-val strategy-textarea" placeholder="Value or [TF].Indicator" style="width: auto;">
        <button class="hud-btn" style="color: var(--danger);" onclick="this.parentElement.remove(); syncVisualToQuery('${section}')">
            <i class="fas fa-trash"></i>
        </button>
    `;

    if (data) {
        if (rowCount > 0 && data.logic) {
            const logicOpElement = row.querySelector('.rule-logic-op');
            if (logicOpElement) logicOpElement.value = data.logic;
        }
        const tfElement = row.querySelector('.rule-tf');
        if (tfElement && data.tf) tfElement.value = data.tf;
        const indElement = row.querySelector('.rule-ind');
        if (indElement && data.ind) indElement.value = data.ind;
        const opElement = row.querySelector('.rule-op');
        if (opElement && data.op) opElement.value = data.op;
        const valElement = row.querySelector('.rule-val');
        if (valElement && data.val) valElement.value = data.val;

        if (data.ind === 'Pattern') {
            togglePatternValueField(row, data.val);
        }
    }

    rulesContainer.appendChild(row);

    // Specific listener for Pattern indicator to toggle value field type
    row.querySelector('.rule-ind').addEventListener('change', () => {
        togglePatternValueField(row);
        syncVisualToQuery(section);
    });

    row.querySelectorAll('select, input').forEach(el => {
        // Skip Pattern value select if it's already handled, but actually global change listener is fine.
        el.addEventListener('change', () => syncVisualToQuery(section));
        if (el.tagName === 'INPUT') {
            el.addEventListener('input', () => syncVisualToQuery(section));
        }
    });

    // Initial sync - using setTimeout to ensure DOM is ready if called during init
    setTimeout(() => syncVisualToQuery(section), 0);
}

function togglePatternValueField(row, defaultVal = 'Bullish') {
    const ind = row.querySelector('.rule-ind').value;
    const valContainer = row.querySelector('.rule-val').parentElement;
    const oldVal = row.querySelector('.rule-val');

    if (ind === 'Pattern') {
        const select = document.createElement('select');
        select.className = 'select-input rule-val';
        select.style.width = 'auto';
        select.innerHTML = `
            <option value="Bullish">Bullish</option>
            <option value="Bearish">Bearish</option>
        `;
        select.value = (defaultVal === 'Bullish' || defaultVal === 'Bearish') ? defaultVal : 'Bullish';
        select.addEventListener('change', () => {
            const section = row.closest('[id$="-visual-rules"]').id.split('-')[0];
            syncVisualToQuery(section);
        });
        valContainer.replaceChild(select, oldVal);

        // Pattern logic only makes sense with "==" or "!="
        const opSelect = row.querySelector('.rule-op');
        if (opSelect.value !== '==' && opSelect.value !== '!=') {
            opSelect.value = '==';
        }
    } else if (oldVal.tagName === 'SELECT') {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'select-input rule-val strategy-textarea';
        input.placeholder = 'Value or [TF].Indicator';
        input.style.width = 'auto';
        input.addEventListener('input', () => {
            const section = row.closest('[id$="-visual-rules"]').id.split('-')[0];
            syncVisualToQuery(section);
        });
        valContainer.replaceChild(input, oldVal);
    }
}

function syncVisualToQuery(section) {
    const rulesContainer = document.getElementById(`${section}-visual-rules`);
    const textarea = document.getElementById(`strat-${section}-query`);
    if (!rulesContainer || !textarea) return;

    const rows = rulesContainer.querySelectorAll('.visual-rule-row');
    let queryParts = [];

    rows.forEach((row, idx) => {
        const logicElement = row.querySelector('.rule-logic-op');
        const logic = idx === 0 ? "" : (logicElement ? logicElement.value : "");
        const tf = row.querySelector('.rule-tf').value;
        const ind = row.querySelector('.rule-ind').value;
        const op = row.querySelector('.rule-op').value;
        const val = row.querySelector('.rule-val').value;

        if (ind && op && val) {
            let part = `${tf}.${ind} ${op} ${val}`;
            if (logic) {
                queryParts.push(` ${logic} ${part}`);
            } else {
                queryParts.push(part);
            }
        }
    });

    textarea.value = queryParts.join('');
    updateStrategyExplainer();
}

function syncQueryToVisual(section) {
    const rulesContainer = document.getElementById(`${section}-visual-rules`);
    const textarea = document.getElementById(`strat-${section}-query`);
    if (!rulesContainer || !textarea) return;

    const query = textarea.value.trim();
    rulesContainer.innerHTML = '';

    if (!query) return;

    // Best-effort parser for [TF].IND OP VAL (AND|OR) ...
    // Split by AND or OR (case insensitive)
    const parts = query.split(/\s+(AND|OR)\s+/i);

    let currentLogic = null;

    for (let i = 0; i < parts.length; i++) {
        let p = parts[i].trim();
        if (p.toUpperCase() === 'AND' || p.toUpperCase() === 'OR') {
            currentLogic = p.toUpperCase();
            continue;
        }

        // Flexible Parse: ([TF].)?TOKEN OP VALUE
        const match = p.match(/(\[[^\]]+\]\.)?([^\s]+)\s+([<>=!]+)\s+(.+)/);
        if (match) {
            let tf = match[1] ? match[1].slice(0, -1) : "[Daily]";
            const data = {
                logic: currentLogic,
                tf: tf,
                ind: match[2],
                op: match[3],
                val: match[4]
            };
            addVisualRule(section, data);
            currentLogic = null; // Reset for the next rule
        }
    }

    // If no rules were parsed but text exists, add one empty rule
    if (rulesContainer.innerHTML === '' && query !== '') {
        addVisualRule(section);
    }
}

function setGlobalEditorMode(mode) {
    currentEditorMode = mode;
    document.querySelectorAll('.mode-toggle-btn').forEach(btn => btn.classList.remove('active'));
    if (mode === 'query') {
        document.getElementById('btn-global-query').classList.add('active');
        document.querySelectorAll('[id$="-query"]').forEach(el => el.classList.remove('hidden'));
        document.querySelectorAll('[id$="-visual"]').forEach(el => el.classList.add('hidden'));
    } else {
        document.getElementById('btn-global-visual').classList.add('active');
        document.querySelectorAll('[id$="-query"]').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('[id$="-visual"]').forEach(el => el.classList.remove('hidden'));

        // Sync Visual from Query
        ['entry', 'exit', 'target', 'sl', 'accum'].forEach(section => {
            syncQueryToVisual(section);
        });
    }
}

// --- Support & Flow rendering ---
function renderSupportGuide() {
    const container = document.getElementById('support-content');
    if (!container) return;

    // Cache content to avoid heavy reconstruction on every tab switch
    if (container.innerHTML.trim().length > 100) {
        return; // Already rendered
    }

    container.innerHTML = `
        <div class="support-grid">
            <div class="support-sidebar">
                <ul class="support-nav">
                    <li onclick="scrollToSupport('intro')"><i class="fas fa-info-circle"></i> Introduction</li>
                    <li onclick="scrollToSupport('architecture')"><i class="fas fa-sitemap"></i> System Architecture</li>
                    <li onclick="scrollToSupport('ui-flow')"><i class="fas fa-route"></i> UI & Navigation</li>
                    <li onclick="scrollToSupport('data-flow')"><i class="fas fa-database"></i> Data Pipeline</li>
                    <li onclick="scrollToSupport('backtest-logic')"><i class="fas fa-vial"></i> Backtest Logic</li>
                </ul>
            </div>
            <div class="support-body">
                <section id="support-intro" class="support-section">
                    <div class="support-card-hero">
                        <h2><i class="fas fa-info-circle"></i> Introduction</h2>
                        <p>StockSignal Pro is an advanced algorithmic trading platform designed for the Indian equity market. It combines real-time technical analysis with deep fundamental data to provide high-conviction trading signals.</p>
                        <div class="support-cards">
                            <div class="s-card">
                                <i class="fas fa-bolt"></i>
                                <h4>Real-time Calculation</h4>
                                <p>Vectorized indicator processing using Pandas-TA.</p>
                            </div>
                            <div class="s-card">
                                <i class="fas fa-project-diagram"></i>
                                <h4>Confluence Score</h4>
                                <p>Proprietary ranking system (-5 to +5) for signal strength.</p>
                            </div>
                        </div>
                    </div>
                </section>

                <hr class="support-sep">

                <section id="support-architecture" class="support-section">
                    <h2><i class="fas fa-sitemap"></i> System Architecture</h2>
                    <p>High-level overview of the StockSignal Pro ecosystem.</p>
                    <pre class="mermaid">
graph TD
    User(("User"))
    subgraph Frontend ["Frontend (Browser)"]
        UI["Vanilla HTML/CSS"]
        JS["ES6 app.js"]
        SVG["Custom SVG Charting"]
    end
    
    subgraph Backend ["Backend (FastAPI)"]
        API["app.py API Layer"]
        IE["indicator_engine.py"]
        SE["scenario_engine.py"]
    end
    
    subgraph Data ["Data Layer"]
        AppDB[("App MySQL")]
        DMDB[("Datamart MySQL")]
    end
    
    Upstox["Upstox API"]
    
    User <--> UI
    UI <--> JS
    JS <--> API
    API <--> AppDB
    API <--> DMDB
    API --> IE
    API --> SE
    IE <--> AppDB
    IE <--> DMDB
    SE <--> AppDB
    
    API -- "SSE" --> JS
    Upstox -- "Candle Data" --> API
                    </pre>
                </section>

                <hr class="support-sep">

                <section id="support-ui-flow" class="support-section">
                    <h2><i class="fas fa-route"></i> UI & Navigation Flow</h2>
                    <p>User journey and state transitions through the application.</p>
                    <pre class="mermaid">
stateDiagram-v2
    [*] --> Login
    Login --> Dashboard: Successful Auth
    
    state Dashboard {
        [*] --> SwingMode
        SwingMode --> IntradayMode: Toggle
        IntradayMode --> SwingMode: Toggle
    }
    
    Dashboard --> StrategyLab: Navigate
    Dashboard --> ProScreener: Navigate
    Dashboard --> Settings: Navigate
    
    StrategyLab --> Backtest: Run Logic
    ProScreener --> TradeModal: Click Stock
                    </pre>
                </section>

                <hr class="support-sep">

                <section id="support-data-flow" class="support-section">
                    <h2><i class="fas fa-database"></i> Data Pipeline Flow</h2>
                    <p>The journey from raw candle data to actionable signals.</p>
                    <pre class="mermaid">
flowchart TD
    Start([Trigger Calculate]) --> Fetch{"Fetch Data?"}
    Fetch -- "Yes" --> UpstoxAPI["Request Upstox Candles"]
    UpstoxAPI --> Synthesis["Synthesize 1d from 5m if needed"]
    Synthesis --> StoreRaw["Store in app_sg_ohlcv_prices"]
    Fetch -- "No" --> LoadRaw["Load Latest OHLCV"]
    StoreRaw --> LoadRaw
    LoadRaw --> Indicators["Calculate Technicals: RSI, EMA, ST, Vol"]
    Indicators --> Patterns["Analyze Candlestick Patterns"]
    Patterns --> Weights["Assign Pattern Strength 1-3"]
    Weights --> Confluence["Calculate Confluence Rank -5 to +5"]
    Confluence --> TradePlan["Generate SL/Target Levels"]
    TradePlan --> Upsert["Upsert to app_sg_calculated_signals"]
                    </pre>
                </section>

                <hr class="support-sep">

                <section id="support-backtest-logic" class="support-section">
                    <h2><i class="fas fa-vial"></i> Core Backtest Logic</h2>
                    <p>Simulation states for the Advanced Scenario Backtester.</p>
                    <pre class="mermaid">
flowchart TD
    Setup([Initialize Backtest]) --> Load["Load Historical OHLCV"]
    Load --> Shift["Shift Multi-Timeframe Indicators"]
    Shift --> Loop["Iterate Chronological Candles"]
    Loop --> CheckPos{Position Open?}
    CheckPos -- "No" --> EntryLogic{RSI & Logic Met?}
    EntryLogic -- "Yes" --> Open["Open Tranche 1"]
    CheckPos -- "Yes" --> SL{Stop Loss Hit?}
    SL -- "Yes" --> CloseAll["Exit Position"]
    SL -- "No" --> Scale{Pullback Met?}
    Scale -- "Yes" --> Tranche["Open Tranche 2/3"]
    Scale -- "No" --> Target1{T1 Price or ST Break?}
    Target1 -- "Yes" --> Partial["Close T1 Weight"]
    Target1 -- "No" --> Target2{T2 Price or Major ST Break?}
    Target2 -- "Yes" --> CloseAll
    CloseAll --> Loop
                    </pre>
                </section>
            </div>
        </div>
    `;

    // Re-initialize Mermaid for the new content
    setTimeout(async () => {
        if (window.mermaid) {
            try {
                if (!window._mermaid_initialized) {
                    window.mermaid.initialize({ startOnLoad: false, theme: 'dark' });
                    window._mermaid_initialized = true;
                }
                document.querySelectorAll('#support-view .mermaid').forEach(el => {
                    let code = el.textContent || "";
                    code = code.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
                    el.textContent = code;
                    el.removeAttribute('data-processed');
                });
                await window.mermaid.run({
                    nodes: document.querySelectorAll('#support-view .mermaid')
                });
            } catch (err) {
                console.error("Mermaid Render Error:", err);
            }
        }
    }, 250);
}

// --- Pro Screener Strategy Blueprint Integration ---

/**
 * Populates the Strategy Blueprint dropdown in the Pro Screener
 */
async function populateScreenerBlueprints() {
    const dropdown = document.getElementById('screener-filter-custom');
    if (!dropdown) return;

    try {
        const res = await fetch('/api/strategies/list');
        const json = await res.json();
        screenerBlueprints = json.data || [];

        const currentVal = dropdown.value;
        dropdown.innerHTML = '<option value="none">Default Confluence Ranking</option>';

        screenerBlueprints.forEach(s => {
            const isSwing = s.mode === 'swing';
            const suffix = s.timeframe ? ` [${s.mode.toUpperCase()} - ${s.timeframe}]` : '';
            const option = document.createElement('option');
            option.value = s.id;
            option.textContent = s.name + suffix;
            dropdown.appendChild(option);
        });

        if (currentVal && screenerBlueprints.some(s => s.id == currentVal)) {
            dropdown.value = currentVal;
        }
    } catch (e) {
        console.error("Failed to populate screener blueprints:", e);
    }
}

/**
 * Handles selection of a custom strategy in the Pro Screener
 */
async function onScreenerCustomStrategyChange() {
    const id = document.getElementById('screener-filter-custom').value;
    if (id === 'none') {
        activeScreenerBlueprint = null;
        screenerTfDataMap = {}; // Reset MTF cache
        applyScreenerFilters();
        return;
    }

    const strat = screenerBlueprints.find(s => s.id == id);
    if (!strat) return;

    // Strict Mapping: Auto-switch mode and timeframe if defined
    if (strat.mode && strat.mode !== currentMode) {
        showToast(`Switching to ${strat.mode.toUpperCase()} for this strategy...`, "info");
        await setMode(strat.mode);
    }

    if (strat.timeframe) {
        // ALWAYS update the Screener TF picker to match the blueprint's focus
        const tfPicker = document.getElementById('screener-filter-tf');
        if (tfPicker) {
            const apiTf = TF_MAP[strat.timeframe] || strat.timeframe;
            tfPicker.value = apiTf;
        }

        // Force a re-fetch of the main signals list for this specific timeframe 
        // to ensure we have the best data for the evaluation engine
        await renderProScreener();
    } else {
        // If no specific timeframe, ensure we still have clean data
        await renderProScreener();
    }

    // NEW: Fetch all timeframes required by the blueprint to enable full MTF matching in Screener
    try {
        const data = JSON.parse(strat.query);
        const translated = translateUserQuery(data.entry, data.side, data.tf);
        
        // Always include the profile's base timeframe in the fetch list
        const usedTfs = [translated.primaryTf || data.tf];

        const tfRegex = /[\[\{]\s*(.*?)\s*[\]\}]/g;
        let m;
        // Scan the translated logic and other components for extra timeframes
        [translated.query, data.target, data.sl].forEach(logic => {
            if (!logic) return;
            while ((m = tfRegex.exec(logic)) !== null) {
                usedTfs.push(m[1]);
            }
        });

        const uniqueTfs = [...new Set(usedTfs)].filter(val => val);
        if (uniqueTfs.length > 0) {
            showToast(`Syncing Market Data for '${strat.name}'...`, "info");
            await Promise.all(uniqueTfs.map(async (tf) => {
                const normalizedTf = Object.keys(TF_MAP).find(k => k.toLowerCase() === tf.toLowerCase());
                const apiTf = normalizedTf ? TF_MAP[normalizedTf] : tf;

                // Map timeframe to correct profile_id (mode)
                const fetchMode = ['1d', '1w', '1mo'].includes(apiTf) ? 'swing' : 'intraday';

                const res = await fetch(`/api/signals?mode=${fetchMode}&timeframe=${apiTf}`);
                const json = await res.json();
                if (json.status === 'success') {
                    screenerTfDataMap[tf] = json.data;
                    // Also seed with case-insensitive name if needed
                    if (normalizedTf) screenerTfDataMap[normalizedTf] = json.data;
                }
            }));
        }
    } catch (e) {
        console.warn("MTF fetch failed for blueprint:", e);
    }

    // Parse logic
    try {
        const data = JSON.parse(strat.query);
        const translated = translateUserQuery(data.entry, data.side, data.tf);
        activeScreenerBlueprint = {
            id: strat.id,
            name: strat.name,
            logic: translated.query,
            side: translated.side,
            tf: translated.tf,
            originalData: data
        };

        applyScreenerFilters();
        showToast(`Blueprint '${strat.name}' Applied.`, "success");
    } catch (e) {
        console.error("Blueprint parse error:", e);
        showToast("Invalid Strategy Logic.", "error");
    }
}

/**
 * Core Evaluation Engine for Blueprints in Screener
 * Matches a specific stock signal against complex SQL-like query logic
 */
function evaluateBlueprintMatch(stock, blueprint) {
    if (!blueprint.logic) return true;

    // 1. Prepare Indicator Mapping (Same as Lab)
    const indMap = {
        'RSI': 'rsi',
        'rsi': 'rsi',
        'ST': 'supertrend_dir',
        'st': 'supertrend_dir',
        'ST_V': 'supertrend_value',
        'st_v': 'supertrend_value',
        'LTP': 'ltp',
        'ltp': 'ltp',
        'Price': 'ltp',
        'price': 'ltp',
        'Close': 'ltp',
        'close': 'ltp',
        'EMA_C': 'ema_signal',
        'ema_c': 'ema_signal',
        'EMA_F': 'ema_fast',
        'ema_f': 'ema_fast',
        'EMA_S': 'ema_slow',
        'ema_s': 'ema_slow',
        'EMA_V': 'ema_value',
        'ema_v': 'ema_value',
        'VOL': 'volume_signal',
        'vol': 'volume_signal',
        'VOL_R': 'volume_ratio',
        'vol_r': 'volume_ratio',
        'Pattern': 'candlestick_pattern',
        'pattern': 'candlestick_pattern',
        'Pattern_Score': 'pattern_score',
        'pattern_score': 'pattern_score',
        'ROE': 'roe',
        'roe': 'roe',
        'PE': 'pe',
        'pe': 'pe',
        'HIGH': 'prev_high',
        'high': 'prev_high',
        'LOW': 'prev_low',
        'low': 'prev_low',
        'PREV_HIGH': 'prev_high',
        'prev_high': 'prev_high',
        'PREV_LOW': 'prev_low',
        'prev_low': 'prev_low'
    };

    // 2. Process query for JS execution
    let processed = blueprint.logic
        .replace(/AND /gi, '&& ')
        .replace(/OR /gi, '|| ')
        .replace(/NOT /gi, '! ')
        .replace(/==/g, '===');

    // Handle Percentage Arithmetic: [token] +/- X%
    const pctRegex = /(\[.*?\]\.[A-Z_0-9]+)\s*([\+\-])\s*(\d+\.?\d*)%/g;
    processed = processed.replace(pctRegex, (match, token, op, val) => {
        const factor = op === '+' ? (1 + (parseFloat(val) / 100)) : (1 - (parseFloat(val) / 100));
        return `(${token} * ${factor})`;
    });

    // 3. Resolve Tokens (Simplified for Screener)
    const tokenRegex = /[\[\{]\s*(.*?)\s*[\]\}]\s*\.\s*([A-Z_a-z0-9]+)/g;

    // Replace tokens with stock values
    const finalQuery = processed.replace(tokenRegex, (match, tf, attr) => {
        const key = indMap[attr] || attr;

        let val = null;

        // 1. Precise MTF Match (from full data fetch)
        if (screenerTfDataMap[tf]) {
            const m = screenerTfDataMap[tf].find(s => s.isin === stock.isin);
            if (m) val = m[key];
        }

        // 2. MTF SuperTrend Fallback (cached in primary stock row)
        if (val === undefined || val === null) {
            if (stock.mtf_data && stock.mtf_data[tf]) {
                if (key === 'supertrend_dir' || attr === 'ST') {
                    val = stock.mtf_data[tf];
                }
            }
        }

        // 3. Current Timeframe Fallback
        if (val === undefined || val === null) {
            val = stock[key];
        }

        // 4. DMA/SMA JSON Lookup (Consistent with Strategy Lab)
        if (val === undefined || val === null) {
            let s_obj = null;
            if (screenerTfDataMap[tf]) {
                s_obj = screenerTfDataMap[tf].find(s => s.isin === stock.isin);
            } else {
                s_obj = stock;
            }

            if (s_obj && s_obj.dma_data) {
                let dma = s_obj.dma_data;
                if (typeof dma === 'string') {
                    try { dma = JSON.parse(dma); } catch (e) { }
                }
                if (typeof dma === 'object' && dma !== null) {
                    const dmaKey = Object.keys(dma).find(k => k.toLowerCase() === attr.toLowerCase());
                    if (dmaKey) val = dma[dmaKey];
                }
            }
        }

        if (val === undefined || val === null) {
            // Case-insensitive fallback for fundamentals/others
            const lowerKey = Object.keys(stock).find(k => k.toLowerCase() === attr.toLowerCase());
            if (lowerKey) val = stock[lowerKey];
        }

        // --- Sentiment & Status Normalization (Match Strategy Lab) ---
        if (attr === 'ST' || key === 'supertrend_dir' || attr === 'Supertrend') {
            // Ensure ST is always BUY/SELL
            val = (val === 'BUY' || val === 1 || val === true) ? "BUY" : "SELL";
        } else if (attr === 'VOL' || key === 'volume_signal') {
            val = (val === 'BULL_SPIKE' || val === 'BULL_S') ? "BULL_S" : ((val === 'BEAR_SPIKE' || val === 'BEAR_S') ? "BEAR_S" : "NONE");
        } else if (attr === 'Pattern' || key === 'candlestick_pattern') {
            if (typeof val === 'string' && val.includes('Bullish')) val = "Bullish";
            else if (typeof val === 'string' && val.includes('Bearish')) val = "Bearish";
            else val = "None";
        }

        if (val === undefined || val === null) return 0;

        if (typeof val === 'string') return `'${val}'`;
        return val;
    });

    try {
        return new Function(`return (${finalQuery})`)();
    } catch (e) {
        return false;
    }
}

// Hook into switchTab to refresh blueprints
const _screener_origSwitchTab = switchTab;
switchTab = function (tabId) {
    if (tabId === 'pro-screener') {
        populateScreenerBlueprints();
    }
    _screener_origSwitchTab(tabId);
};

function scrollToSupport(id) {
    const el = document.getElementById('support-' + id);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
    }
}
