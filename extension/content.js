// Captures the highlighted claim plus surrounding paragraph, links (including footnote targets),
// page publication date, quotation context, and renders non-destructive verdict highlights on the page.
(() => {
  const MARK_ATTR = 'data-source-hunter';
  const TONE_STYLE = {
    ok: { bg: 'rgba(30, 122, 76, 0.16)', border: '#1e7a4c' },
    warn: { bg: 'rgba(168, 100, 0, 0.18)', border: '#a86400' },
    bad: { bg: 'rgba(179, 38, 30, 0.16)', border: '#b3261e' },
    none: { bg: 'rgba(91, 103, 115, 0.16)', border: '#5b6773' },
  };
  let lastClaim = '';
  let lastRange = null;

  function cleanClaimText(text = '') {
    let s = String(text || '').replace(/\s+/g, ' ').trim();
    // Strip bracketed citation markers: [76], [n], [a], [citation needed], [note 1], [clarification needed], etc.
    s = s.replace(/\[\s*(?:\d+(?:\s*[,–-]\s*\d+)*|[a-z]|citation needed|note\s*\d+|clarification needed)\s*\]/gi, '');
    // Strip unicode superscripts (e.g. ⁰ ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹)
    s = s.replace(/[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]+/g, '');
    // Strip trailing superscript footnote digits at word ends before punctuation or boundary
    s = s.replace(/([a-zA-Z]{3,})\d{1,3}(?=[.,;:\s]|$)/g, '$1');
    // Clean whitespace before punctuation
    s = s.replace(/\s+([.,;:!?])/g, '$1');
    return s.replace(/\s+/g, ' ').trim();
  }

  const ABBR = /(?:\b[A-Z]|\b(?:Dr|Mr|Mrs|Ms|St|Inc|Corp|Ltd|vs|No|Fig|approx|etc))\.$/;
  function splitSentences(plain = '') {
    const parts = plain.split(/(?<=[.!?]["\u201D')\]]?)\s+(?=["\u201C'(\[]?[A-Z0-9])/);
    const out = [];
    for (const p of parts) {
      if (out.length && ABBR.test(out[out.length - 1])) out[out.length - 1] += ' ' + p;
      else out.push(p);
    }
    return out.filter(Boolean);
  }

  const MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };

  function parseVisibleDate(str) {
    if (!str) return null;
    const s = String(str).trim();
    // 31 July 2025 or 31 Jul 2025
    let m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/);
    if (m) {
      const mo = MONTHS[m[2].toLowerCase()];
      if (mo) {
        const d = String(m[1]).padStart(2, '0');
        const moStr = String(mo).padStart(2, '0');
        return `${m[3]}-${moStr}-${d}`;
      }
    }
    // July 31, 2025 or Jul 13, 2022
    m = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/);
    if (m) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo) {
        const d = String(m[2]).padStart(2, '0');
        const moStr = String(mo).padStart(2, '0');
        return `${m[3]}-${moStr}-${d}`;
      }
    }
    // ISO 2025-07-31
    m = s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (m) return m[1];
    return null;
  }

  const dateOf = () => {
    // Wikipedia and living pages are continuously edited; dates are uncertain
    const isWiki = /(?:^|\.)wikipedia\.org$/i.test(location.hostname) || /\/wiki\//i.test(location.pathname) || /(?:^|\.)wik[a-z0-9-]*\./i.test(location.hostname);
    if (isWiki) {
      return { date: null, dateSource: 'page-text', dateUncertain: true, dateReason: 'wiki page continuously edited (living page)' };
    }

    // 1. Metadata dates
    const sel = ['meta[property="article:published_time"]', 'meta[name="date"]', 'meta[name="pubdate"]', 'meta[itemprop="datePublished"]', 'meta[name="citation_publication_date"]', 'meta[name="dc.date"]'];
    for (const s of sel) { const v = document.querySelector(s)?.content; if (v) return { date: v, dateSource: 'page-metadata' }; }
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { const m = el.textContent.match(/"datePublished"\s*:\s*"([^"]+)"/); if (m) return { date: m[1], dateSource: 'page-metadata' }; } catch {}
    }
    const dtAttr = document.querySelector('article time[datetime], time[datetime]')?.getAttribute('datetime');
    if (dtAttr) return { date: dtAttr, dateSource: 'page-metadata' };

    // 2. Visible dates near title or byline within top of article (Requirement 6)
    const timeEls = Array.from(document.querySelectorAll('header time, article time, time, .byline, .date, [class*="date"], [class*="publish"], [class*="time"], header'));
    for (const el of timeEls) {
      const d = parseVisibleDate(el.textContent);
      if (d) return { date: d, dateSource: 'page-text' };
    }

    // Top text scan (top 3000 chars of article or body)
    const topText = (document.querySelector('article, main, body')?.innerText || '').slice(0, 3000);
    const pubMatch = topText.match(/(?:published|posted|released|updated|date)[:\s-]*([A-Za-z0-9, ]{6,30})/i);
    if (pubMatch) {
      const d = parseVisibleDate(pubMatch[1]);
      if (d) return { date: d, dateSource: 'page-text' };
    }
    const dTop = parseVisibleDate(topText);
    if (dTop) return { date: dTop, dateSource: 'page-text' };

    return { date: null, dateSource: null };
  };

  function collect() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const rawSel = sel.toString().replace(/\s+/g, ' ').trim();
    if (rawSel.length < 2) return null;

    const cleaned = cleanClaimText(rawSel);
    const sents = splitSentences(cleaned);
    const isMulti = sents.length > 1;
    // Trace first sentence containing a number, otherwise the first sentence
    const targetSentence = isMulti
      ? (sents.find((s) => /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|percent|billion|million)\b/i.test(s)) || sents[0])
      : cleaned;

    const claim = targetSentence.replace(/\s+/g, ' ').trim();
    const range = sel.getRangeAt(0);
    lastClaim = claim;
    try { lastRange = range.cloneRange(); } catch { lastRange = null; }
    let node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentElement;
    const block = node.closest('p,li,blockquote,figcaption,td,dd') || node.closest('div,section,article') || node;
    const paragraph = (block.innerText || '').slice(0, 2500);
    const links = [];
    const seen = new Set();
    const add = (a, extra = {}, textOverride) => {
      if (!a.href || seen.has(a.href)) return;
      seen.add(a.href);
      links.push({ href: a.href, text: (textOverride || a.textContent || '').trim().slice(0, 140), ...extra });
    };
    const scan = (root, extra) =>
      root.querySelectorAll('a[href]').forEach((a) => {
        const hash = a.getAttribute('href') || '';
        if (hash.startsWith('#') && hash.length > 1) {
          const target = document.getElementById(decodeURIComponent(hash.slice(1)));
          if (target) target.querySelectorAll('a[href]').forEach((t) => !t.getAttribute('href')?.startsWith('#') && add(t, { ...extra, inSelection: true }, target.innerText.slice(0, 140)));
          return;
        }
        add(a, { ...extra, inSelection: sel.containsNode(a, true) });
      });
    scan(block, {});
    [block.previousElementSibling, block.nextElementSibling].forEach((s) => s && scan(s, { adjacent: true }));
    const q = (n) => n.closest && n.closest('q,blockquote');
    const inQuote = !!q(node) || /^["\u201C]/.test(claim);

    const refHeading = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, b')).find((el) =>
      /^(?:references|sources|bibliography|further reading|related links)\b/i.test((el.textContent || '').trim())
    );
    const refContainer = document.querySelector('#references, #sources, .references, .sources, [id*="reference"], [class*="reference"]');
    const hasReferenceLinks = Boolean(refHeading || refContainer || document.querySelector('a[href*="reference"], a[href*="source"]'));

    const dInfo = dateOf();

    return {
      claim,
      rawHighlight: rawSel,
      fullHighlight: cleaned,
      multiSentence: isMulti,
      multiSentenceTip: isMulti ? 'Tip: For best results, highlight one claim at a time.' : null,
      url: location.href,
      title: document.title,
      date: dInfo.date,
      dateSource: dInfo.dateSource,
      hasReferenceLinks,
      paragraph,
      links: links.slice(0, 40),
      inQuote,
    };
  }

  function clearMarks() {
    document.querySelectorAll(`mark[${MARK_ATTR}]`).forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
  }

  function makeMark(tone, title) {
    const s = TONE_STYLE[tone] || TONE_STYLE.none;
    const mark = document.createElement('mark');
    mark.setAttribute(MARK_ATTR, tone || 'none');
    mark.setAttribute('title', title);
    mark.style.cssText = `background:${s.bg};color:inherit;border-bottom:2px solid ${s.border};border-radius:2px;padding:0 2px;box-decoration-break:clone;-webkit-box-decoration-break:clone;`;
    return mark;
  }

  function wrapSingleText(range, tone, title) {
    if (range.startContainer !== range.endContainer || range.startContainer.nodeType !== 3) return false;
    try {
      const mark = makeMark(tone, title);
      range.surroundContents(mark);
      return true;
    } catch {
      return false;
    }
  }

  function findTextAndMark(claim, tone, title) {
    const needle = String(claim || '').replace(/\s+/g, ' ').trim();
    if (needle.length < 4) return false;
    const short = needle.slice(0, 80);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const tag = n.parentElement?.tagName;
        if (!tag || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT)$/i.test(tag)) return NodeFilter.FILTER_REJECT;
        if (n.parentElement?.isContentEditable) return NodeFilter.FILTER_REJECT;
        return n.nodeValue && n.nodeValue.trim().length > 3 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.nodeValue.indexOf(short);
      if (idx >= 0) {
        const len = node.nodeValue.indexOf(needle) === idx ? needle.length : short.length;
        const r = document.createRange();
        r.setStart(node, idx);
        r.setEnd(node, Math.min(node.nodeValue.length, idx + len));
        if (wrapSingleText(r, tone, title)) return true;
      }
    }
    return false;
  }

  function applyHighlight({ claim, tone, headline, originHost }) {
    clearMarks();
    const title = `Source Hunter (${originHost || 'trace'}): ${headline || 'Checked'}`;
    if (lastRange && claim === lastClaim && document.contains(lastRange.startContainer)) {
      if (wrapSingleText(lastRange, tone, title)) {
        lastRange = null;
        return true;
      }
    }
    return findTextAndMark(claim, tone, title);
  }

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg.type === 'COLLECT') send(collect());
    else if (msg.type === 'HIGHLIGHT_VERDICT') send({ ok: applyHighlight(msg) });
    else if (msg.type === 'CLEAR_HIGHLIGHT') {
      clearMarks();
      send({ ok: true });
    }
  });

  // Floating "Trace source" button next to a highlight (closed Shadow DOM so page CSS cannot break it)
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:absolute;z-index:2147483647;display:none';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML =
    '<style>button{font:600 12.5px system-ui,-apple-system,sans-serif;letter-spacing:.01em;background:#18212b;color:#f4f6f8;border:1px solid #2b343d;border-radius:6px;padding:6px 11px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.22);transition:background .15s}button:hover{background:#0b6a8a}button:focus-visible{outline:2px solid #6cc4e0;outline-offset:2px}</style>' +
    '<button type="button">Trace source</button>';
  document.documentElement.appendChild(host);
  const btn = root.querySelector('button');
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => {
    const payload = collect();
    host.style.display = 'none';
    if (payload) chrome.runtime.sendMessage({ type: 'TRACE', payload });
  });
  const hide = () => (host.style.display = 'none');
  document.addEventListener('mouseup', () => setTimeout(() => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || s.toString().trim().length < 2) return hide();
    const range = s.getRangeAt(0);
    const rects = range.getClientRects();
    const lastRect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    const btnW = 112;
    const btnH = 32;

    // Preferred: to the right of selection end so it never covers neighbouring text
    let left = window.scrollX + lastRect.right + 8;
    let top = window.scrollY + lastRect.top + (lastRect.height - btnH) / 2;

    // Flip above if near right edge of viewport
    if (lastRect.right + btnW + 16 > window.innerWidth) {
      left = Math.max(8, window.scrollX + lastRect.right - btnW);
      top = window.scrollY + lastRect.top - btnH - 6;
    }

    // Flip below if placing above would go off-screen at the top
    if (top - window.scrollY < 8) {
      top = window.scrollY + lastRect.bottom + 6;
    }

    // Keep left within viewport margins
    const maxLeft = window.scrollX + window.innerWidth - btnW - 12;
    left = Math.max(8, Math.min(left, maxLeft));

    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
    host.style.display = 'block';
  }, 10));
  document.addEventListener('mousedown', (e) => { if (e.target !== host) hide(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyT' || e.key === 'T' || e.key === 't')) {
      const payload = collect();
      if (payload) {
        hide();
        chrome.runtime.sendMessage({ type: 'TRACE', payload });
      }
    }
  });
})();
