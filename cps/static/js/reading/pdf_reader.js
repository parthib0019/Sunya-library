/**
 * Google Play Books Style PDF Reader
 * Sunya Library
 */

(function () {
  'use strict';

  // Polyfill Promise.withResolvers for older browser compatibility
  if (typeof Promise.withResolvers === 'undefined') {
    Promise.withResolvers = function () {
      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
  }

  // Reader State
  const state = {
    pdfDoc: null,
    currentPage: 1,
    totalPages: 0,
    scale: 'fit',
    customScale: 1.0,
    currentRenderTask: null,
    isRendering: false,
    renderPendingPage: null,
    barsVisible: true,
    theme: localStorage.getItem('sunya_pdf_theme') || 'light',
    highlights: [],
    selectedText: '',
    selectedRange: null,
    activeHighlight: null,
    touchStartX: 0,
    touchStartY: 0,
    saveBookmarkTimeout: null,
  };

  // DOM Elements
  const DOM = {};

  function initDOM() {
    DOM.app = document.getElementById('readerApp');
    DOM.topBar = document.getElementById('topBar');
    DOM.bottomBar = document.getElementById('bottomBar');
    DOM.viewport = document.getElementById('readerViewport');
    DOM.pageContainer = document.getElementById('pageContainer');
    DOM.pageCanvas = document.getElementById('pageCanvas');
    DOM.textLayer = document.getElementById('textLayer');
    DOM.highlightsLayer = document.getElementById('highlightsLayer');
    DOM.loadingOverlay = document.getElementById('loadingOverlay');
    DOM.pageSlider = document.getElementById('pageSlider');
    DOM.sliderTooltip = document.getElementById('sliderTooltip');
    DOM.pageInput = document.getElementById('pageInput');
    DOM.totalPagesEl = document.getElementById('totalPages');
    DOM.pagePercentEl = document.getElementById('pagePercent');
    DOM.prevBtn = document.getElementById('prevPageBtn');
    DOM.nextBtn = document.getElementById('nextPageBtn');
    DOM.navPrevZone = document.getElementById('navPrevZone');
    DOM.navNextZone = document.getElementById('navNextZone');
    DOM.themeBtn = document.getElementById('themeBtn');
    DOM.themeIcon = document.getElementById('themeIcon');
    DOM.highlighterMenu = document.getElementById('highlighterMenu');
    DOM.highlightEditPopover = document.getElementById('highlightEditPopover');
    DOM.drawerBackdrop = document.getElementById('drawerBackdrop');
    DOM.tocDrawer = document.getElementById('tocDrawer');
    DOM.tocList = document.getElementById('tocList');
    DOM.tocBtn = document.getElementById('tocBtn');
    DOM.closeTocBtn = document.getElementById('closeTocBtn');
    DOM.highlightsDrawer = document.getElementById('highlightsDrawer');
    DOM.highlightsList = document.getElementById('highlightsList');
    DOM.highlightsBtn = document.getElementById('highlightsBtn');
    DOM.closeHighlightsBtn = document.getElementById('closeHighlightsBtn');
    DOM.highlightsBadge = document.getElementById('highlightsBadge');
    DOM.zoomInBtn = document.getElementById('zoomInBtn');
    DOM.zoomOutBtn = document.getElementById('zoomOutBtn');
    DOM.zoomFitBtn = document.getElementById('zoomFitBtn');
    DOM.fullscreenBtn = document.getElementById('fullscreenBtn');
    DOM.toast = document.getElementById('toast');
    DOM.csrfToken = document.querySelector('input[name="csrf_token"]')?.value || '';
  }

  // Toast Notification
  function showToast(message, duration = 2200) {
    if (!DOM.toast) return;
    DOM.toast.textContent = message;
    DOM.toast.classList.add('show');
    clearTimeout(DOM.toast._timer);
    DOM.toast._timer = setTimeout(() => {
      DOM.toast.classList.remove('show');
    }, duration);
  }

  // Highlight Storage Management
  function getStorageKey() {
    return 'sunya_pdf_highlights_' + window.calibre.bookId;
  }

  function loadHighlights() {
    try {
      const data = localStorage.getItem(getStorageKey());
      state.highlights = data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn('Failed to load highlights from localStorage', e);
      state.highlights = [];
    }
    updateHighlightsBadge();
  }

  function saveHighlights() {
    try {
      localStorage.setItem(getStorageKey(), JSON.stringify(state.highlights));
    } catch (e) {
      console.warn('Failed to save highlights', e);
    }
    updateHighlightsBadge();
    renderHighlightsDrawer();
  }

  function updateHighlightsBadge() {
    if (!DOM.highlightsBadge) return;
    const count = state.highlights.length;
    if (count > 0) {
      DOM.highlightsBadge.textContent = count > 99 ? '99+' : count;
      DOM.highlightsBadge.style.display = 'block';
    } else {
      DOM.highlightsBadge.style.display = 'none';
    }
  }

  // Bookmark / Reading Position Persistence
  function getInitialPage() {
    // 1. URL Hash #page=X
    const match = location.hash.match(/page=(\d+)/);
    if (match) {
      const p = parseInt(match[1], 10);
      if (p >= 1) return p;
    }

    // 2. Server Bookmark from Database
    if (window.calibre.bookmark) {
      const bPage = parseInt(window.calibre.bookmark, 10);
      if (bPage >= 1) return bPage;
    }

    // 3. LocalStorage
    try {
      const local = localStorage.getItem('sunya_pdf_last_page_' + window.calibre.bookId);
      if (local) {
        const lPage = parseInt(local, 10);
        if (lPage >= 1) return lPage;
      }
    } catch (e) {}

    return 1;
  }

  function saveCurrentPosition(pageNumber) {
    // Save to LocalStorage immediately
    try {
      localStorage.setItem('sunya_pdf_last_page_' + window.calibre.bookId, pageNumber);
    } catch (e) {}

    // Save URL Hash
    history.replaceState(null, '', '#page=' + pageNumber);

    // Save to Calibre Backend Bookmark endpoint (debounced)
    if (window.calibre.useBookmarks && window.calibre.bookmarkUrl) {
      clearTimeout(state.saveBookmarkTimeout);
      state.saveBookmarkTimeout = setTimeout(() => {
        const formData = new FormData();
        formData.append('bookmark', String(pageNumber));
        if (DOM.csrfToken) {
          formData.append('csrf_token', DOM.csrfToken);
        }
        fetch(window.calibre.bookmarkUrl, {
          method: 'POST',
          body: formData,
        }).catch((err) => console.debug('Bookmark sync error:', err));
      }, 1200);
    }
  }

  // Theme Management
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('sunya_pdf_theme', theme);

    if (DOM.themeIcon) {
      if (theme === 'dark') {
        DOM.themeIcon.innerHTML = '<path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>';
      } else if (theme === 'sepia') {
        DOM.themeIcon.innerHTML = '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 16H6c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1h12c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1z"/>';
      } else {
        DOM.themeIcon.innerHTML = '<path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 0 0 0-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/>';
      }
    }
  }

  function cycleTheme() {
    if (state.theme === 'light') applyTheme('sepia');
    else if (state.theme === 'sepia') applyTheme('dark');
    else applyTheme('light');
    showToast('Theme: ' + state.theme.charAt(0).toUpperCase() + state.theme.slice(1));
  }

  // Bars Visibility Toggle (Immersive Reading)
  function toggleBars() {
    state.barsVisible = !state.barsVisible;
    if (state.barsVisible) {
      DOM.topBar.classList.remove('hidden-bar');
      DOM.bottomBar.classList.remove('hidden-bar');
    } else {
      DOM.topBar.classList.add('hidden-bar');
      DOM.bottomBar.classList.add('hidden-bar');
      hideHighlighterMenu();
      hideHighlightEditPopover();
    }
  }

  function showBars() {
    state.barsVisible = true;
    DOM.topBar.classList.remove('hidden-bar');
    DOM.bottomBar.classList.remove('hidden-bar');
  }

  // Drawers (TOC & Highlights)
  function openDrawer(drawer) {
    DOM.drawerBackdrop.classList.add('active');
    drawer.classList.add('active');
    hideHighlighterMenu();
    hideHighlightEditPopover();
  }

  function closeAllDrawers() {
    DOM.drawerBackdrop.classList.remove('active');
    DOM.tocDrawer.classList.remove('active');
    DOM.highlightsDrawer.classList.remove('active');
  }

  // Fullscreen
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }

  // Table of Contents (Lazy loaded on demand)
  let tocLoaded = false;
  async function loadTOC() {
    if (tocLoaded || !state.pdfDoc) return;
    DOM.tocList.innerHTML = '<div class="empty-state">Loading table of contents…</div>';
    try {
      const outline = await state.pdfDoc.getOutline();
      DOM.tocList.innerHTML = '';
      tocLoaded = true;
      if (!outline || outline.length === 0) {
        DOM.tocList.innerHTML = '<div class="empty-state">No table of contents available for this book.</div>';
        return;
      }

      function buildTOCItems(items, level = 0) {
        items.forEach((item) => {
          const li = document.createElement('li');
          li.className = 'toc-item';
          li.style.paddingLeft = (16 + level * 14) + 'px';

          const titleSpan = document.createElement('span');
          titleSpan.className = 'toc-title';
          titleSpan.textContent = item.title;

          li.appendChild(titleSpan);

          li.addEventListener('click', async () => {
            closeAllDrawers();
            let dest = item.dest;
            if (typeof dest === 'string') {
              dest = await state.pdfDoc.getDestination(dest);
            }
            if (dest && dest[0]) {
              const pageIndex = await state.pdfDoc.getPageIndex(dest[0]);
              goToPage(pageIndex + 1);
            }
          });

          DOM.tocList.appendChild(li);

          if (item.items && item.items.length > 0) {
            buildTOCItems(item.items, level + 1);
          }
        });
      }

      buildTOCItems(outline);
    } catch (e) {
      console.warn('Error loading outline:', e);
      DOM.tocList.innerHTML = '<div class="empty-state">Unable to load table of contents.</div>';
    }
  }

  // Highlights Drawer
  function renderHighlightsDrawer() {
    if (!DOM.highlightsList) return;
    DOM.highlightsList.innerHTML = '';

    if (state.highlights.length === 0) {
      DOM.highlightsList.innerHTML = '<div class="empty-state">No highlights yet.<br><br>Select text in the book to highlight with your favorite colors!</div>';
      return;
    }

    // Sort by page number ascending
    const sorted = [...state.highlights].sort((a, b) => a.page - b.page);

    sorted.forEach((hl) => {
      const card = document.createElement('div');
      card.className = 'hl-card';

      const colorMap = {
        yellow: '#ffd600',
        green: '#00c853',
        blue: '#2979ff',
        pink: '#ff4081',
        orange: '#ff6d00',
      };
      const borderColor = colorMap[hl.color] || '#ffd600';

      card.innerHTML = `
        <div class="hl-card-header">
          <span class="hl-page-badge">Page ${hl.page}</span>
          <button class="btn-menu-action btn-del-hl" title="Delete" style="color:var(--text-muted)">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
        <div class="hl-card-text" style="border-left-color: ${borderColor};">"${escapeHtml(hl.text)}"</div>
        ${hl.note ? `<div class="hl-card-note">Note: ${escapeHtml(hl.note)}</div>` : ''}
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-del-hl')) {
          e.stopPropagation();
          deleteHighlight(hl.id);
          return;
        }
        closeAllDrawers();
        goToPage(hl.page);
      });

      DOM.highlightsList.appendChild(card);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Page Rendering (Fast & Progressive)
  async function renderPage(pageNumber, direction = 0) {
    if (pageNumber < 1 || pageNumber > state.totalPages) return;
    if (state.isRendering) {
      if (state.currentRenderTask) {
        state.currentRenderTask.cancel();
      }
      state.renderPendingPage = { pageNumber, direction };
      return;
    }

    state.isRendering = true;
    state.currentPage = pageNumber;

    // Page flip transition feedback
    if (direction > 0) {
      DOM.pageContainer.classList.add('flip-forward');
    } else if (direction < 0) {
      DOM.pageContainer.classList.add('flip-backward');
    }

    try {
      const page = await state.pdfDoc.getPage(pageNumber);

      // Compute scale
      const unscaledViewport = page.getViewport({ scale: 1.0 });
      let computedScale = state.customScale;

      const viewportWidth = DOM.viewport.clientWidth - 40;
      const viewportHeight = DOM.viewport.clientHeight - 150;

      if (state.scale === 'fit') {
        const scaleW = viewportWidth / unscaledViewport.width;
        const scaleH = viewportHeight / unscaledViewport.height;
        computedScale = Math.min(scaleW, scaleH) * 0.96;
      } else if (state.scale === 'width') {
        computedScale = (viewportWidth / unscaledViewport.width) * 0.96;
      }

      // Keep scale within sane bounds
      computedScale = Math.max(0.3, Math.min(computedScale, 4.0));

      // Optimize scale for mobile devices to prevent GPU memory stalls on large books
      const isMobile = window.innerWidth <= 768 || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
      const maxDpr = isMobile ? 1.75 : 2.5;
      const outputScale = Math.min(window.devicePixelRatio || 1, maxDpr);
      const viewport = page.getViewport({ scale: computedScale });

      // Setup canvas with high DPI sharpness
      DOM.pageCanvas.width = Math.floor(viewport.width * outputScale);
      DOM.pageCanvas.height = Math.floor(viewport.height * outputScale);
      DOM.pageCanvas.style.width = Math.floor(viewport.width) + 'px';
      DOM.pageCanvas.style.height = Math.floor(viewport.height) + 'px';

      DOM.pageContainer.style.width = Math.floor(viewport.width) + 'px';
      DOM.pageContainer.style.height = Math.floor(viewport.height) + 'px';
      DOM.pageContainer.style.setProperty('--scale-factor', computedScale);

      const ctx = DOM.pageCanvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

      const renderContext = {
        canvasContext: ctx,
        transform: transform,
        viewport: viewport,
      };

      state.currentRenderTask = page.render(renderContext);
      await state.currentRenderTask.promise;

      // Render Text Layer for Text Selection and Highlighting
      DOM.textLayer.innerHTML = '';
      DOM.textLayer.style.width = Math.floor(viewport.width) + 'px';
      DOM.textLayer.style.height = Math.floor(viewport.height) + 'px';
      DOM.textLayer.style.setProperty('--scale-factor', computedScale);

      try {
        const textContentSource = await page.getTextContent();
        if (pdfjsLib.TextLayer) {
          const textLayer = new pdfjsLib.TextLayer({
            textContentSource: textContentSource,
            container: DOM.textLayer,
            viewport: viewport,
          });
          await textLayer.render();
        }
      } catch (err) {
        console.warn('Text layer render warning:', err);
      }

      // Render Highlights on this page
      renderPageHighlights(pageNumber);

      // Transition cleanup
      DOM.pageContainer.classList.remove('flip-forward', 'flip-backward');

      // Update UI elements
      updateUI();

      // Persist reading position
      saveCurrentPosition(pageNumber);

      // Hide loading spinner
      DOM.loadingOverlay.classList.add('hidden-spinner');
    } catch (err) {
      if (err.name !== 'RenderingCancelledException') {
        console.error('Page render error:', err);
      }
    } finally {
      state.isRendering = false;
      DOM.pageContainer.classList.remove('flip-forward', 'flip-backward');

      if (state.renderPendingPage !== null) {
        const next = state.renderPendingPage;
        state.renderPendingPage = null;
        renderPage(next.pageNumber, next.direction);
      }
    }
  }

  function goToPage(pageNumber) {
    if (pageNumber < 1) pageNumber = 1;
    if (pageNumber > state.totalPages) pageNumber = state.totalPages;
    if (pageNumber === state.currentPage) return;

    hideHighlighterMenu();
    hideHighlightEditPopover();
    const dir = pageNumber > state.currentPage ? 1 : -1;
    renderPage(pageNumber, dir);
  }

  function updateUI() {
    DOM.pageSlider.value = state.currentPage;
    DOM.pageInput.value = state.currentPage;
    DOM.totalPagesEl.textContent = state.totalPages;

    const pct = Math.round((state.currentPage / state.totalPages) * 100);
    DOM.pagePercentEl.textContent = `(${pct}%)`;

    DOM.prevBtn.disabled = state.currentPage <= 1;
    DOM.nextBtn.disabled = state.currentPage >= state.totalPages;
  }

  // Highlight Rendering and Interaction
  function renderPageHighlights(pageNumber) {
    DOM.highlightsLayer.innerHTML = '';
    const pageHighlights = state.highlights.filter((h) => h.page === pageNumber);

    pageHighlights.forEach((hl) => {
      hl.rects.forEach((rect) => {
        const el = document.createElement('div');
        el.className = `pdf-highlight color-${hl.color}`;
        el.dataset.highlightId = hl.id;
        el.style.left = (rect.x * 100) + '%';
        el.style.top = (rect.y * 100) + '%';
        el.style.width = (rect.w * 100) + '%';
        el.style.height = (rect.h * 100) + '%';

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          showHighlightEditPopover(hl, el);
        });

        DOM.highlightsLayer.appendChild(el);
      });
    });
  }

  function handleTextSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      hideHighlighterMenu();
      return;
    }

    const text = sel.toString().trim();
    if (text.length < 1) {
      hideHighlighterMenu();
      return;
    }

    const range = sel.getRangeAt(0);
    // Ensure selection is inside textLayer
    if (!DOM.textLayer.contains(range.commonAncestorContainer)) {
      hideHighlighterMenu();
      return;
    }

    state.selectedText = text;
    state.selectedRange = range.cloneRange();

    const rect = range.getBoundingClientRect();
    showHighlighterMenu(rect);
  }

  function showHighlighterMenu(targetRect) {
    DOM.highlighterMenu.classList.add('active');
    const menuWidth = 230;
    let left = targetRect.left + (targetRect.width / 2) - (menuWidth / 2);
    let top = targetRect.top - 52;

    // Clamp inside viewport
    if (left < 10) left = 10;
    if (left + menuWidth > window.innerWidth - 10) left = window.innerWidth - menuWidth - 10;
    if (top < 60) top = targetRect.bottom + 10;

    DOM.highlighterMenu.style.left = left + 'px';
    DOM.highlighterMenu.style.top = top + 'px';
  }

  function hideHighlighterMenu() {
    DOM.highlighterMenu.classList.remove('active');
  }

  function addHighlight(color) {
    if (!state.selectedRange || !state.selectedText) return;

    const pageRect = DOM.pageContainer.getBoundingClientRect();
    const clientRects = state.selectedRange.getClientRects();
    const normalizedRects = [];

    for (let i = 0; i < clientRects.length; i++) {
      const cr = clientRects[i];
      if (cr.width <= 0 || cr.height <= 0) continue;
      normalizedRects.push({
        x: (cr.left - pageRect.left) / pageRect.width,
        y: (cr.top - pageRect.top) / pageRect.height,
        w: cr.width / pageRect.width,
        h: cr.height / pageRect.height,
      });
    }

    if (normalizedRects.length === 0) return;

    const newHl = {
      id: 'hl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      page: state.currentPage,
      color: color,
      text: state.selectedText,
      rects: normalizedRects,
      note: '',
      createdAt: Date.now(),
    };

    state.highlights.push(newHl);
    saveHighlights();
    renderPageHighlights(state.currentPage);

    window.getSelection().removeAllRanges();
    hideHighlighterMenu();
    showToast('Text highlighted (' + color + ')');
  }

  function showHighlightEditPopover(hl, targetEl) {
    state.activeHighlight = hl;
    DOM.highlightEditPopover.classList.add('active');

    const rect = targetEl.getBoundingClientRect();
    const popoverWidth = 260;
    let left = rect.left + (rect.width / 2) - (popoverWidth / 2);
    let top = rect.top - 120;

    if (left < 10) left = 10;
    if (left + popoverWidth > window.innerWidth - 10) left = window.innerWidth - popoverWidth - 10;
    if (top < 60) top = rect.bottom + 10;

    DOM.highlightEditPopover.style.left = left + 'px';
    DOM.highlightEditPopover.style.top = top + 'px';

    const noteArea = document.getElementById('popoverNoteArea');
    if (noteArea) {
      noteArea.value = hl.note || '';
    }
  }

  function hideHighlightEditPopover() {
    DOM.highlightEditPopover.classList.remove('active');
    state.activeHighlight = null;
  }

  function deleteHighlight(hlId) {
    state.highlights = state.highlights.filter((h) => h.id !== hlId);
    saveHighlights();
    renderPageHighlights(state.currentPage);
    hideHighlightEditPopover();
    showToast('Highlight deleted');
  }

  function updateHighlightColor(color) {
    if (!state.activeHighlight) return;
    state.activeHighlight.color = color;
    saveHighlights();
    renderPageHighlights(state.currentPage);
    showToast('Color changed');
  }

  function saveHighlightNote() {
    if (!state.activeHighlight) return;
    const noteArea = document.getElementById('popoverNoteArea');
    if (noteArea) {
      state.activeHighlight.note = noteArea.value.trim();
      saveHighlights();
      showToast('Note saved');
    }
    hideHighlightEditPopover();
  }

  // Event Listeners Initialization
  function attachEvents() {
    // Top Bar Back Button
    document.getElementById('backBtn')?.addEventListener('click', () => {
      if (document.referrer && document.referrer.includes(window.location.host)) {
        window.history.back();
      } else {
        window.location.href = window.calibre.bookDetailUrl || '/';
      }
    });

    // Theme Toggle
    DOM.themeBtn?.addEventListener('click', cycleTheme);

    // Fullscreen Toggle
    DOM.fullscreenBtn?.addEventListener('click', toggleFullscreen);

    // TOC Drawer (Lazy-loaded on first click)
    DOM.tocBtn?.addEventListener('click', () => {
      loadTOC();
      openDrawer(DOM.tocDrawer);
    });
    DOM.closeTocBtn?.addEventListener('click', closeAllDrawers);

    // Highlights Drawer
    DOM.highlightsBtn?.addEventListener('click', () => {
      renderHighlightsDrawer();
      openDrawer(DOM.highlightsDrawer);
    });
    DOM.closeHighlightsBtn?.addEventListener('click', closeAllDrawers);
    DOM.drawerBackdrop?.addEventListener('click', closeAllDrawers);

    // Fast tap binding on mobile (prevents 300ms click delay)
    function bindFastTap(el, action) {
      if (!el) return;
      let touchMoved = false;
      el.addEventListener('touchstart', () => { touchMoved = false; }, { passive: true });
      el.addEventListener('touchmove', () => { touchMoved = true; }, { passive: true });
      el.addEventListener('touchend', (e) => {
        if (!touchMoved) {
          e.preventDefault();
          e.stopPropagation();
          action();
        }
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        action();
      });
    }

    // Navigation Buttons & Margin Zones
    bindFastTap(DOM.prevBtn, () => goToPage(state.currentPage - 1));
    bindFastTap(DOM.nextBtn, () => goToPage(state.currentPage + 1));
    bindFastTap(DOM.navPrevZone, () => goToPage(state.currentPage - 1));
    bindFastTap(DOM.navNextZone, () => goToPage(state.currentPage + 1));

    // Center Click on Viewport toggles Immersive Mode (Bars)
    DOM.viewport?.addEventListener('click', (e) => {
      // Ignore if clicking on text selection, menus, or drawers
      if (
        e.target.closest('#highlighterMenu') ||
        e.target.closest('#highlightEditPopover') ||
        e.target.closest('.side-drawer') ||
        e.target.closest('.margin-nav-zone') ||
        e.target.closest('.btn-icon')
      ) {
        return;
      }
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        return;
      }
      toggleBars();
    });

    // Page Scrubber / Slider
    DOM.pageSlider?.addEventListener('input', (e) => {
      const targetPage = parseInt(e.target.value, 10);
      if (DOM.sliderTooltip) {
        DOM.sliderTooltip.textContent = 'Page ' + targetPage;
        DOM.sliderTooltip.style.display = 'block';
        const ratio = (targetPage - 1) / (state.totalPages - 1 || 1);
        DOM.sliderTooltip.style.left = (ratio * 100) + '%';
      }
    });

    DOM.pageSlider?.addEventListener('change', (e) => {
      if (DOM.sliderTooltip) DOM.sliderTooltip.style.display = 'none';
      goToPage(parseInt(e.target.value, 10));
    });

    // Page Number Input Jump
    DOM.pageInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const p = parseInt(DOM.pageInput.value, 10);
        if (!isNaN(p)) goToPage(p);
      }
    });

    // Zoom Controls
    DOM.zoomInBtn?.addEventListener('click', () => {
      state.scale = 'custom';
      state.customScale = (state.customScale || 1.0) * 1.2;
      renderPage(state.currentPage);
    });
    DOM.zoomOutBtn?.addEventListener('click', () => {
      state.scale = 'custom';
      state.customScale = (state.customScale || 1.0) / 1.2;
      renderPage(state.currentPage);
    });
    DOM.zoomFitBtn?.addEventListener('click', () => {
      state.scale = state.scale === 'fit' ? 'width' : 'fit';
      renderPage(state.currentPage);
      showToast(state.scale === 'fit' ? 'Fit Page' : 'Fit Width');
    });

    // Window Resize Debounce
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.scale === 'fit' || state.scale === 'width') {
          renderPage(state.currentPage);
        }
      }, 150);
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      // Disable print & save shortcuts (No print, No download)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 's')) {
        e.preventDefault();
        return false;
      }

      // Ignore when typing inside input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
        case 'j':
        case 'l':
          e.preventDefault();
          goToPage(state.currentPage + 1);
          break;
        case 'ArrowLeft':
        case 'PageUp':
        case 'k':
        case 'h':
          e.preventDefault();
          goToPage(state.currentPage - 1);
          break;
        case 'Home':
          e.preventDefault();
          goToPage(1);
          break;
        case 'End':
          e.preventDefault();
          goToPage(state.totalPages);
          break;
        case 't':
          cycleTheme();
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'Escape':
          closeAllDrawers();
          hideHighlighterMenu();
          hideHighlightEditPopover();
          break;
      }
    });

    // Touch Swipe Gestures
    DOM.viewport?.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        state.touchStartX = e.touches[0].clientX;
        state.touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    DOM.viewport?.addEventListener('touchend', (e) => {
      if (e.changedTouches.length === 1) {
        const deltaX = e.changedTouches[0].clientX - state.touchStartX;
        const deltaY = e.changedTouches[0].clientY - state.touchStartY;

        // If horizontal swipe > 50px and larger than vertical swipe
        if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
          if (deltaX < 0) {
            goToPage(state.currentPage + 1); // Swipe left -> Next Page
          } else {
            goToPage(state.currentPage - 1); // Swipe right -> Prev Page
          }
        }
      }
    }, { passive: true });

    // Text Selection for Highlighting
    document.addEventListener('selectionchange', () => {
      // Small delay to allow selection coordinates to settle
      setTimeout(handleTextSelection, 10);
    });

    // Highlighter Menu Color Buttons
    document.querySelectorAll('.hl-color-dot').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const color = btn.dataset.color;
        addHighlight(color);
      });
    });

    // Copy selected text button
    document.getElementById('btnCopyText')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.selectedText) {
        navigator.clipboard.writeText(state.selectedText).then(() => {
          showToast('Text copied to clipboard');
          window.getSelection().removeAllRanges();
          hideHighlighterMenu();
        });
      }
    });

    // Close highlighter menu button
    document.getElementById('btnCloseMenu')?.addEventListener('click', (e) => {
      e.stopPropagation();
      window.getSelection().removeAllRanges();
      hideHighlighterMenu();
    });

    // Popover Color Switchers
    document.querySelectorAll('.popover-colors .hl-color-dot').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        updateHighlightColor(btn.dataset.color);
      });
    });

    // Popover Delete Button
    document.getElementById('btnDeleteHl')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.activeHighlight) {
        deleteHighlight(state.activeHighlight.id);
      }
    });

    // Popover Copy Button
    document.getElementById('btnCopyHlText')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.activeHighlight && state.activeHighlight.text) {
        navigator.clipboard.writeText(state.activeHighlight.text).then(() => {
          showToast('Text copied');
        });
      }
    });

    // Popover Save Note Button
    document.getElementById('btnSaveNote')?.addEventListener('click', (e) => {
      e.stopPropagation();
      saveHighlightNote();
    });

    // Popover Close Button
    document.getElementById('btnClosePopover')?.addEventListener('click', (e) => {
      e.stopPropagation();
      hideHighlightEditPopover();
    });
  }

  // Main Startup
  async function init() {
    initDOM();
    applyTheme(state.theme);
    loadHighlights();
    attachEvents();

    // Configure PDF.js Worker
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = window.calibre.workerUrl;
    }

    try {
      // Progressive streaming load
      const loadingTask = pdfjsLib.getDocument({
        url: window.calibre.bookUrl,
        cMapUrl: window.calibre.cMapUrl,
        cMapPacked: true,
        rangeChunkSize: 262144, // 256KB chunks for fast scanned-page transfer over Wi-Fi
        disableAutoFetch: true,  // Do NOT download the whole 112MB file in background
        disableStream: false,
        disableRange: false,
      });

      state.pdfDoc = await loadingTask.promise;
      state.totalPages = state.pdfDoc.numPages;
      DOM.pageSlider.max = state.totalPages;
      DOM.pageInput.max = state.totalPages;

      // Determine initial page
      const startPage = getInitialPage();

      // Render initial page immediately for maximum speed
      await renderPage(startPage);
    } catch (err) {
      console.error('Failed to open PDF:', err);
      if (DOM.loadingOverlay) {
        DOM.loadingOverlay.innerHTML = `
          <div style="text-align:center; padding: 20px;">
            <p style="font-size:18px; font-weight:600; color:#d93025;">Unable to open PDF</p>
            <p style="font-size:14px; color:var(--text-sub);">${escapeHtml(err.message || 'File could not be loaded.')}</p>
            <button onclick="location.reload()" style="margin-top:12px; padding:8px 16px; border-radius:6px; background:var(--accent); color:#fff; border:none; cursor:pointer;">Retry</button>
          </div>
        `;
      }
    }
  }

  // Start on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
