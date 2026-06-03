const state = {
    gridActive: false,
    gridContainer: null,
    currentPage: 0,
    allImages: [],
    PAGE_SIZE: 24,
    keyHandler: null,
    resizeHandler: null,
    imageCache: []
};

// ── 注入覆蓋樣式（唯一能打贏 4chan CSS 的方式）──────────────
function injectOverrideStyles() {
    if (document.getElementById('grid-override-styles')) return;
    const style = document.createElement('style');
    style.id = 'grid-override-styles';
    style.textContent = `
        /* 強制覆蓋 4chan 對 img 的所有尺寸限制 */
        #custom-grid .grid-img-wrapper {
            width: 100% !important;
            background: #111 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        }
        #custom-grid .grid-img-wrapper img {
            width: 100% !important;
            height: auto !important;
            display: block !important;
            max-width: none !important;
        }
    `;
    document.head.appendChild(style);
}

// ── 抓取所有圖片 ──────────────────────────────────────────
async function fetchThreadImages() {
    const images = [];
    const seenUrls = new Set(); // ← 用於去重

    // 優先用 a.fileThumb，它是 4chan 標準縮圖連結，一張圖只會出現一次
    // 再補抓可能漏掉的 .file a[href*="i.4cdn.org"]（兩者可能重疊，靠 Set 去重）
    const imageLinks = document.querySelectorAll('a.fileThumb, .file a[href*="i.4cdn.org"]');
    if (!imageLinks.length) return images;

    for (const link of imageLinks) {
        try {
            const imgUrl = link.href;

            // 已見過此 URL → 跳過
            if (seenUrls.has(imgUrl)) continue;
            seenUrls.add(imgUrl);

            const filenameEl =
                link.querySelector('.fileText, span.fileName') ||
                link.parentElement?.querySelector('.fileText');
            const filename = filenameEl
                ? filenameEl.textContent.trim()
                : `image-${images.length + 1}`;
                
            let type = 'image';
            if (imgUrl.endsWith('.webm') || imgUrl.endsWith('.mp4')) {
                type = 'webm';
            } else if (imgUrl.endsWith('.gif')) {
                type = 'gif';
            }

            images.push({ url: imgUrl, filename, type });
        } catch (e) {
            console.error('處理圖片失敗:', e);
        }
    }
    return images;
}

// ── 燈箱 ─────────────────────────────────────────────────
function openLightbox(images, startIndex) {
    if (!images.length) return;

    const lightbox = document.createElement('div');
    lightbox.style.cssText = `
        position:fixed;top:0;left:0;width:100vw;height:100vh;
        background:rgba(0,0,0,0.98);z-index:99999;
        display:flex;align-items:center;justify-content:center;
    `;

    let currentIndex = startIndex;

    const img = document.createElement('img');
    img.src = images[currentIndex].url;
    img.style.cssText = 'max-width:90vw;max-height:90vh;object-fit:contain;';

    const makeBtn = (text, css) => {
        const b = document.createElement('button');
        b.textContent = text;
        b.style.cssText = css;
        return b;
    };

    const closeBtn = makeBtn('↩ 返回網格', `
        position:absolute;top:20px;right:20px;
        padding:10px 20px;background:#1565c0;color:#fff;
        border:none;border-radius:4px;cursor:pointer;font-weight:bold;
    `);
    const closeAllBtn = makeBtn('✕ 關閉全部', `
        position:absolute;top:20px;right:160px;
        padding:10px 20px;background:#d32f2f;color:#fff;
        border:none;border-radius:4px;cursor:pointer;font-weight:bold;
    `);
    const prevBtn = makeBtn('← 上一張', `
        position:absolute;left:20px;padding:10px 20px;
        background:rgba(255,255,255,0.2);color:#fff;
        border:none;border-radius:4px;cursor:pointer;
    `);
    const nextBtn = makeBtn('下一張 →', `
        position:absolute;right:20px;padding:10px 20px;
        background:rgba(255,255,255,0.2);color:#fff;
        border:none;border-radius:4px;cursor:pointer;
    `);

    const counter = document.createElement('div');
    counter.style.cssText = `
        position:absolute;bottom:20px;left:50%;transform:translateX(-50%);
        color:#ccc;font-size:14px;
    `;
    const updateCounter = () => {
        counter.textContent = `${currentIndex + 1} / ${images.length}`;
        img.src = images[currentIndex].url;
        // 預載下一張
        const next = images[(currentIndex + 1) % images.length];
        if (next) new Image().src = next.url;
    };
    updateCounter();

    const close = () => {
        document.body.removeChild(lightbox);
        document.body.style.overflow = '';
        document.removeEventListener('keydown', lbKeyHandler);
    };
    const closeAll = () => {
        close();
        closeGrid();
    };
    const lbKeyHandler = (e) => {
        if (e.key === 'ArrowLeft')  { currentIndex = (currentIndex - 1 + images.length) % images.length; updateCounter(); }
        if (e.key === 'ArrowRight') { currentIndex = (currentIndex + 1) % images.length; updateCounter(); }
        if (e.key === 'Escape') close();       // Escape = 返回網格（只關燈箱）
        if (e.key === 'q' || e.key === 'Q') closeAll();  // Q = 關閉全部
    };

    closeBtn.addEventListener('click', close);
    closeAllBtn.addEventListener('click', closeAll);
    prevBtn.addEventListener('click', () => { currentIndex = (currentIndex - 1 + images.length) % images.length; updateCounter(); });
    nextBtn.addEventListener('click', () => { currentIndex = (currentIndex + 1) % images.length; updateCounter(); });
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) close(); });
    document.addEventListener('keydown', lbKeyHandler);

    lightbox.append(closeBtn, closeAllBtn, prevBtn, nextBtn, img, counter);
    document.body.appendChild(lightbox);
    document.body.style.overflow = 'hidden';
}

// ── 渲染指定頁的網格 ──────────────────────────────────────
function renderPage(pageIndex) {
    if (!state.gridContainer) return;
    state.currentPage = pageIndex;

    const { allImages, PAGE_SIZE } = state;
    const totalPages = Math.ceil(allImages.length / PAGE_SIZE);
    const start = pageIndex * PAGE_SIZE;
    const pageImages = allImages.slice(start, start + PAGE_SIZE);

    // 清空舊卡片（保留分頁列）
    const pagerEl = state.gridContainer.querySelector('#grid-pager');
    state.gridContainer.innerHTML = '';
    if (pagerEl) state.gridContainer.appendChild(pagerEl);

    // 更新分頁列
    updatePager(pageIndex, totalPages);

    // 渲染卡片
    pageImages.forEach((imgData, i) => {
        const globalIndex = start + i;
        const card = document.createElement('div');
        card.style.cssText = `
            background:#1e1e1e;border-radius:6px;overflow:hidden;
            display:flex;flex-direction:column;align-items:center;
            cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;
            width:100%;max-width:320px;
        `;
        card.addEventListener('mouseenter', () => {
            card.style.transform = 'scale(1.03)';
            card.style.boxShadow = '0 8px 20px rgba(0,0,0,0.6)';
            card.style.outline = '2px solid #1976d2';
        });
        card.addEventListener('mouseleave', () => {
            card.style.transform = '';
            card.style.boxShadow = '';
            card.style.outline = '';
        });

        const wrapper = document.createElement('div');
        wrapper.className = 'grid-img-wrapper';

        if (imgData.type === 'webm') {
            const video = document.createElement('video');
            video.src = imgData.url;
            video.autoplay = true;
            video.muted = true;
            video.loop = true;
            wrapper.appendChild(video);

            const badge = document.createElement('span');
            badge.className = 'grid-media-badge';
            badge.textContent = '[WEBM]';
            wrapper.appendChild(badge);
        } else {
            const img = document.createElement('img');
            img.src = imgData.url;
            img.loading = 'lazy';
            img.alt = imgData.filename;
            wrapper.appendChild(img);

            if (imgData.type === 'gif') {
                const badge = document.createElement('span');
                badge.className = 'grid-media-badge';
                badge.textContent = '[GIF]';
                wrapper.appendChild(badge);
            }
        }

        const label = document.createElement('span');
        label.textContent = imgData.filename;
        label.style.cssText = `
            padding:6px 8px;color:#bbb;font-size:11px;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
            width:100%;box-sizing:border-box;background:#1e1e1e;display:block;
        `;

        card.append(wrapper, label);
        card.addEventListener('click', () => {
            openLightbox(allImages, globalIndex);
        });

        state.gridContainer.appendChild(card);
    });
}

// ── 分頁列 ────────────────────────────────────────────────
function updatePager(currentPage, totalPages) {
    let pager = state.gridContainer.querySelector('#grid-pager');
    if (!pager) {
        pager = document.createElement('div');
        pager.id = 'grid-pager';
        state.gridContainer.prepend(pager);
    }
    pager.innerHTML = '';

    const makeNavBtn = (text, disabled, onClick) => {
        const b = document.createElement('button');
        b.textContent = text;
        b.disabled = disabled;
        b.style.cssText = `
            padding:8px 18px;border:none;border-radius:4px;cursor:pointer;
            font-weight:bold;font-size:14px;
            background:${disabled ? '#444' : '#1976d2'};
            color:${disabled ? '#888' : '#fff'};
        `;
        if (!disabled) b.addEventListener('click', onClick);
        return b;
    };

    const info = document.createElement('span');
    info.style.cssText = 'color:#ccc;font-size:14px;min-width:120px;text-align:center;';
    info.textContent = `第 ${currentPage + 1} 頁 / 共 ${totalPages} 頁`;

    const hint = document.createElement('span');
    hint.style.cssText = 'color:#666;font-size:12px;';
    hint.textContent = '（← → 鍵翻頁）';

    const pageSizeSelect = document.createElement('select');
    pageSizeSelect.style.cssText = 'padding: 4px; border-radius: 4px; background: #333; color: #fff; border: 1px solid #555;';
    [12, 24, 48].forEach(size => {
        const option = document.createElement('option');
        option.value = size;
        option.textContent = `${size} 筆/頁`;
        if (size === state.PAGE_SIZE) option.selected = true;
        pageSizeSelect.appendChild(option);
    });
    pageSizeSelect.addEventListener('change', async (e) => {
        const newSize = parseInt(e.target.value, 10);
        state.PAGE_SIZE = newSize;
        await chrome.storage.local.set({ pageSize: newSize });
        renderPage(0);
    });

    pager.append(
        makeNavBtn('◀ 上一頁', currentPage === 0, () => renderPage(currentPage - 1)),
        info,
        makeNavBtn('下一頁 ▶', currentPage >= totalPages - 1, () => renderPage(currentPage + 1)),
        hint,
        pageSizeSelect
    );
}

// ── 鍵盤左右翻頁 ──────────────────────────────────────────
function gridKeyHandler(e) {
    if (!state.gridActive) return;
    const totalPages = Math.ceil(state.allImages.length / state.PAGE_SIZE);
    if (e.key === 'ArrowLeft' && state.currentPage > 0) {
        renderPage(state.currentPage - 1);
    }
    if (e.key === 'ArrowRight' && state.currentPage < totalPages - 1) {
        renderPage(state.currentPage + 1);
    }
}

// ── 關閉網格 ──────────────────────────────────────────────
function closeGrid() {
    if (state.gridContainer) {
        document.body.removeChild(state.gridContainer);
        state.gridContainer = null;
    }
    const closeBtn = document.getElementById('grid-close-btn');
    if (closeBtn) document.body.removeChild(closeBtn);
    
    const countBadge = document.getElementById('grid-count-badge');
    if (countBadge) document.body.removeChild(countBadge);

    const downloadBtn = document.getElementById('grid-download-btn');
    if (downloadBtn) document.body.removeChild(downloadBtn);

    if (state.resizeHandler) {
        window.removeEventListener('resize', state.resizeHandler);
        state.resizeHandler = null;
    }

    if (state.keyHandler) {
        document.removeEventListener('keydown', state.keyHandler);
        state.keyHandler = null;
    }
    state.gridActive = false;
    document.body.style.overflow = '';
}

function getGridColumns() {
    const w = window.innerWidth;
    if (w < 768) return 2;
    if (w < 1024) return 3;
    if (w < 1440) return 4;
    return 6;
}

// ── 開啟 / 切換網格 ───────────────────────────────────────
async function toggleGridView() {
    if (state.gridActive) {
        closeGrid();
        return;
    }

    const { pageSize = 24 } = await chrome.storage.local.get('pageSize');
    state.PAGE_SIZE = pageSize;

    const freshImages = await fetchThreadImages();
    if (!freshImages.length) {
        alert('此串沒有圖片');
        return;
    }

    // 只有數量不同才更新快取
    if (freshImages.length !== state.allImages.length) {
        state.allImages = freshImages;
    }
    state.currentPage = 0;

    // 關閉按鈕（固定在右上）
    const closeBtn = document.createElement('button');
    closeBtn.id = 'grid-close-btn';
    closeBtn.textContent = '✕ 關閉網格';
    closeBtn.style.cssText = `
        position:fixed;top:14px;left:20px;z-index:100000;
        padding:10px 20px;background:#d32f2f;color:#fff;
        border:none;border-radius:4px;cursor:pointer;font-weight:bold;
        font-size:14px;
    `;
    closeBtn.addEventListener('click', closeGrid);

    // 下載全部按鈕
    const downloadBtn = document.createElement('button');
    downloadBtn.id = 'grid-download-btn';
    downloadBtn.textContent = '⬇ 下載全部 (靜態圖)';
    downloadBtn.style.cssText = `
        position:fixed;top:14px;left:135px;z-index:100000;
        padding:10px 20px;background:#4caf50;color:#fff;
        border:none;border-radius:4px;cursor:pointer;font-weight:bold;
        font-size:14px;
    `;
    downloadBtn.addEventListener('click', async () => {
        for (const img of state.allImages) {
            if (img.type === 'webm') continue; // 跳過影片
            const a = document.createElement('a');
            a.href = img.url;
            a.download = img.filename;
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            await new Promise(r => setTimeout(r, 300)); // 避免觸發瀏覽器封鎖
        }
    });

    // 圖片總數提示
    const countBadge = document.createElement('span');
    countBadge.id = 'grid-count-badge';
    countBadge.style.cssText = `
        position:fixed;top:16px;left:330px;z-index:100000;
        background:#333;color:#ccc;padding:8px 14px;border-radius:4px;font-size:13px;
    `;
    countBadge.textContent = `共 ${state.allImages.length} 張，每頁 ${state.PAGE_SIZE} 張`;

    // 網格容器
    const gridContainer = document.createElement('div');
    gridContainer.id = 'custom-grid';
    gridContainer.style.cssText = `
        position:fixed;top:0;left:0;width:100vw;height:100vh;
        background:rgba(10,10,10,0.97);z-index:99998;
        display:grid;
        grid-template-columns:repeat(${getGridColumns()},1fr);
        align-content:start;
        gap:12px;
        padding:60px 20px 20px;
        overflow-y:auto;
        justify-items:center;
        box-sizing:border-box;
    `;

    document.body.appendChild(closeBtn);
    document.body.appendChild(downloadBtn);
    document.body.appendChild(countBadge);
    document.body.appendChild(gridContainer);

    state.gridContainer = gridContainer;
    state.gridActive = true;
    document.body.style.overflow = 'hidden';

    renderPage(0);

    // 鍵盤翻頁
    state.keyHandler = gridKeyHandler;
    document.addEventListener('keydown', state.keyHandler);

    // 視窗大小改變時更新網格欄數
    let resizeTimeout;
    state.resizeHandler = () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (state.gridContainer) {
                state.gridContainer.style.gridTemplateColumns = `repeat(${getGridColumns()}, 1fr)`;
            }
        }, 200);
    };
    window.addEventListener('resize', state.resizeHandler);
}

// ── 觸發按鈕 ──────────────────────────────────────────────
function addGridViewButton() {
    if (document.getElementById('grid-view-toggle')) return;
    
    const navLinks = document.querySelector('.navLinks.desktop');
    if (navLinks) {
        // 整合進 navLinks（原生風格）
        const link = document.createElement('a');
        link.id = 'grid-view-toggle';
        link.href = 'javascript:void(0)';
        link.textContent = '[圖片網格]';
        link.style.cssText = 'margin-left:8px;cursor:pointer;';
        link.addEventListener('click', toggleGridView);
        navLinks.appendChild(link);
    } else {
        // 備用：固定按鈕
        const btn = document.createElement('button');
        btn.id = 'grid-view-toggle';
        btn.textContent = '📷 圖片網格';
        btn.style.cssText = `
            position:fixed;top:20px;right:20px;z-index:99997;
            padding:10px 20px;background:#1976d2;color:#fff;
            border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:14px;
        `;
        btn.addEventListener('click', toggleGridView);
        document.body.appendChild(btn);
    }
}

// ── 初始化 ────────────────────────────────────────────────
injectOverrideStyles();
addGridViewButton();
