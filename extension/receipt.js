// Provenance receipt generators: structured plain-text citation & editorial 1200x630 Canvas 2D Trail Card PNG.
window.SourceHunterReceipt = (() => {
  const displayDate = (h) => (h?.dateUncertain ? 'date uncertain' : (h?.date || 'date unknown'));
  const originLabel = (hop) => {
    if (hop.role === 'start') return `Starting page \u00B7 ${hop.host}`;
    if (hop.role === 'origin') {
      return hop.sourceKind === 'primary-likely'
        ? `Likely primary source \u00B7 ${hop.host}`
        : `Earliest page found \u00B7 ${hop.host}`;
    }
    return `Cited hop \u00B7 ${hop.host}`;
  };

  function formatCitationText(f, payload) {
    const lines = [];
    lines.push('SOURCE HUNTER PROVENANCE RECEIPT');
    lines.push('===============================');
    lines.push(`Claim: "${payload?.claim || f.claim?.raw || ''}"`);
    lines.push(`Verdict: ${f.code || 'UNKNOWN'} — ${f.headline || ''}`);
    if (f.origin) {
      lines.push(`Earliest page found: ${f.origin.url} (${displayDate(f.origin)}, ${f.origin.sourceKindLabel || f.origin.sourceKind})`);
    }
    if (f.disputeQuote) {
      lines.push(`Disputing quote: "${f.disputeQuote}"`);
    }
    lines.push('');
    lines.push('Chain of custody:');
    (f.chain || []).forEach((hop, idx) => {
      lines.push(`${idx + 1}. [${originLabel(hop)}] (${displayDate(hop)}) — ${hop.url}`);
      lines.push(`   Quote: "${hop.quote}"`);
      if (hop.dispute?.disputeQuote) {
        lines.push(`   Disputing quote: "${hop.dispute.disputeQuote}"`);
      }
      const flags = [...(hop.changedHere && hop.vsCited ? hop.vsCited.flags : hop.vsOrigin?.flags || []), ...(hop.flags || [])];
      flags.forEach((fl) => lines.push(`   Flag [${fl.code}]: ${fl.text}`));
    });
    if (f.stats) {
      lines.push('');
      lines.push(`Checked: ${f.stats.fetches || 0} pages opened, ${f.stats.searches || 0} searches run, ${(f.rejected || []).length} cited pages rejected.`);
    }
    lines.push('');
    lines.push(`Traced with Source Hunter and TinyFish (${new Date().toISOString().slice(0, 10)})`);
    return lines.join('\n');
  }

  function wrapTokens(ctx, tokens, maxW) {
    const lines = [];
    let cur = [];
    let curW = 0;
    const spaceW = ctx.measureText(' ').width;
    for (const tok of tokens) {
      const w = ctx.measureText(tok.text).width;
      if (cur.length && curW + spaceW + w > maxW) {
        lines.push(cur);
        cur = [tok];
        curW = w;
      } else {
        if (cur.length) curW += spaceW;
        cur.push(tok);
        curW += w;
      }
    }
    if (cur.length) lines.push(cur);
    return lines.length ? lines : [[{ text: '', changed: false }]];
  }

  function ellipsizeLines(lines, maxLines) {
    if (lines.length <= maxLines) return lines;
    const sliced = lines.slice(0, maxLines);
    const last = [...sliced[maxLines - 1]];
    if (last.length) {
      const tail = last[last.length - 1];
      last[last.length - 1] = { ...tail, text: tail.text.replace(/[.,;:\s]*$/, '') + '\u2026' };
      sliced[maxLines - 1] = last;
    }
    return sliced;
  }

  function hopTokens(hop) {
    if (hop.quoteDiff && hop.vsOrigin?.code !== 'MATCH' && hop.vsOrigin?.code !== 'CONTRADICTED') {
      return hop.quoteDiff.map((d, i) => ({
        text: (i === 0 ? '\u201C' : '') + d.w + (i === hop.quoteDiff.length - 1 ? '\u201D' : ''),
        changed: !!d.changed,
      }));
    }
    return `\u201C${hop.quote}\u201D`.split(/\s+/).filter(Boolean).map((w) => ({ text: w, changed: false }));
  }

  function drawRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  const DRIFT_LEVEL = {
    MATCH: 0, UNCITED: 1, ROUNDED: 1, YEAR: 1, HEDGE_DROPPED: 2, DIFFERENT_CONTEXT: 2,
    SCOPE: 3, CAUSATION: 3, MISQUOTED: 3, CHANGED: 4, CONTRADICTED: 4, DISPUTED: 4,
  };

  function renderCanvas(f, payload, dark) {
    const W = 1200;
    const H = 630;
    const p = dark
      ? {
          bg: '#10151b', panel: '#182028', ink: '#edf1f5', muted: '#a6b3bf', line: '#2d3742',
          mark: '#5e470c', ok: '#64d397', okBg: '#122b1e', warn: '#f0b354', warnBg: '#2e220f',
          bad: '#f7877f', badBg: '#311716', none: '#aeb9c4', noneBg: '#202831', rail: '#3a4654',
        }
      : {
          bg: '#f6f4ef', panel: '#ffffff', ink: '#17202a', muted: '#4d5966', line: '#d6d1c7',
          mark: '#fde087', ok: '#14633c', okBg: '#e8f5ee', warn: '#7c4600', warnBg: '#fdf3dc',
          bad: '#a61e18', badBg: '#fdeceb', none: '#4d5966', noneBg: '#eceff2', rail: '#c9c3b8',
        };
    const toneMap = {
      ok: [p.ok, p.okBg],
      warn: [p.warn, p.warnBg],
      bad: [p.bad, p.badBg],
      none: [p.none, p.noneBg],
    };
    const [toneColor, toneBg] = toneMap[f.tone] || toneMap.none;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const measurePlain = (font, str, w) => {
      ctx.font = font;
      return wrapTokens(ctx, String(str || '').split(/\s+/).filter(Boolean).map((t) => ({ text: t, changed: false })), w);
    };

    // Background
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, W, H);

    // Top bar (header + date + source count)
    const PAD = 40;
    const cardDate = payload?.recordedAt || new Date().toISOString().slice(0, 10);
    const fetches = f.stats?.fetches || 0;
    const rejected = (f.rejected || []).length;
    ctx.fillStyle = p.muted;
    ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
    ctx.fillText('SOURCE HUNTER  \u00B7  PROVENANCE TRAIL CARD', PAD, 34);
    ctx.textAlign = 'right';
    ctx.fillText(`${cardDate}  \u00B7  ${fetches} source${fetches === 1 ? '' : 's'} opened  \u00B7  ${rejected} rejected`, W - PAD, 34);
    ctx.textAlign = 'left';

    ctx.strokeStyle = p.line;
    ctx.beginPath();
    ctx.moveTo(PAD, 46);
    ctx.lineTo(W - PAD, 46);
    ctx.stroke();

    // Left column (Verdict + Serif Claim + Origin/Drift summary)
    const LX = PAD;
    const LW = 504;
    const COL_TOP = 64;
    const COL_H = 496;

    drawRoundRect(ctx, LX, COL_TOP, LW, COL_H, 10);
    ctx.fillStyle = p.panel;
    ctx.fill();
    ctx.strokeStyle = p.line;
    ctx.stroke();

    // Left tone stripe
    ctx.fillStyle = toneColor;
    ctx.fillRect(LX, COL_TOP + 10, 5, COL_H - 20);

    // Stamp badge top-left of card
    const stampText = (f.code || 'RESULT').toUpperCase();
    ctx.font = '800 12px system-ui, -apple-system, sans-serif';
    const stampW = Math.max(96, ctx.measureText(stampText).width + 24);
    ctx.save();
    ctx.translate(LX + 24 + stampW / 2, COL_TOP + 34);
    ctx.rotate(-0.02);
    drawRoundRect(ctx, -stampW / 2, -13, stampW, 26, 4);
    ctx.fillStyle = toneBg;
    ctx.fill();
    ctx.strokeStyle = toneColor;
    ctx.lineWidth = 1.75;
    ctx.stroke();
    ctx.fillStyle = toneColor;
    ctx.textAlign = 'center';
    ctx.fillText(stampText, 0, 4);
    ctx.restore();
    ctx.lineWidth = 1;
    ctx.textAlign = 'left';

    // Source kind pill beside stamp
    const kindLabel = (f.origin?.sourceKindLabel || f.status || 'VERDICT').toUpperCase();
    ctx.fillStyle = p.muted;
    ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
    ctx.fillText(kindLabel.slice(0, 42), LX + 24 + stampW + 14, COL_TOP + 38);

    // Large serif verdict headline
    const headlineLines = ellipsizeLines(measurePlain('bold 23px Georgia, serif', f.headline || 'Trace result', LW - 48), 3);
    ctx.fillStyle = p.ink;
    ctx.font = 'bold 23px Georgia, serif';
    let ly = COL_TOP + 82;
    headlineLines.forEach((line) => {
      ctx.fillText(line.map((t) => t.text).join(' '), LX + 24, ly);
      ly += 30;
    });

    // Claim in Georgia italic serif with left border
    ly += 8;
    const claimText = `\u201C${payload?.claim || f.claim?.raw || ''}\u201D`;
    const claimLines = ellipsizeLines(measurePlain('italic 18.5px Georgia, serif', claimText, LW - 64), 5);
    const claimH = claimLines.length * 25;
    ctx.fillStyle = p.ink;
    ctx.fillRect(LX + 24, ly - 16, 3, claimH);
    ctx.font = 'italic 18.5px Georgia, serif';
    claimLines.forEach((line, idx) => {
      ctx.fillText(line.map((t) => t.text).join(' '), LX + 38, ly + idx * 25);
    });
    ly += claimH + 14;

    // Disputing sentence callout (when present & space permits)
    if (f.disputeQuote && ly < COL_TOP + COL_H - 120) {
      const dispHop = (f.chain || []).find((h) => h.dispute) || f.origin || f.chain?.[f.chain.length - 1];
      const dispMetaStr = `${f.disputeHost || dispHop?.host || ''}, ${f.disputeDateUncertain ? 'date uncertain' : (f.disputeDate || dispHop?.date || 'date unknown')}`;
      const dispLines = ellipsizeLines(measurePlain('13.5px Georgia, serif', `\u201C${f.disputeQuote}\u201D`, LW - 68), 3);
      const dispH = 36 + dispLines.length * 19;
      ctx.fillStyle = toneBg;
      ctx.fillRect(LX + 24, ly, LW - 48, dispH);
      ctx.fillStyle = p.bad;
      ctx.fillRect(LX + 24, ly, 3, dispH);
      ctx.font = 'bold 10.5px system-ui, sans-serif';
      ctx.fillText('DISPUTING SOURCE SENTENCE', LX + 34, ly + 16);
      ctx.fillStyle = p.ink;
      ctx.font = '13.5px Georgia, serif';
      dispLines.forEach((line, idx) => ctx.fillText(line.map((t) => t.text).join(' '), LX + 34, ly + 35 + idx * 19));
      ctx.fillStyle = p.muted;
      ctx.font = '10.5px system-ui, sans-serif';
      ctx.fillText(dispMetaStr, LX + 34, ly + 35 + dispLines.length * 19 + 2);
    }

    // Bottom of left card: Drift segments + origin meta
    const driftY = COL_TOP + COL_H - 74;
    ctx.strokeStyle = p.line;
    ctx.beginPath();
    ctx.moveTo(LX + 24, driftY - 12);
    ctx.lineTo(LX + LW - 24, driftY - 12);
    ctx.stroke();

    const isNone = f.code === 'NO_SOURCE' || f.status === 'no_source';
    const isUncited = f.code === 'UNCITED' || (f.status === 'earliest_uncited' && f.code !== 'DISPUTED' && f.code !== 'CONTRADICTED');
    const isDisputed = f.code === 'DISPUTED' || f.code === 'CONTRADICTED' || f.status === 'disputed_on_page' || !!f.disputeQuote || (f.chain || []).some((h) => h.dispute);
    const isCitedUnconfirmed = f.code === 'CITED_UNCONFIRMED' || f.status === 'cited_not_confirmed';
    const isPrimaryPub = f.code === 'PRIMARY_PUBLISHER' || f.status === 'publisher_is_source';

    const numbersEqual = Boolean(f.chain?.length >= 2 && f.chain[0]?.quote && f.origin?.quote && (() => {
      const s0 = f.chain[0].quote;
      const so = f.origin.quote;
      const n0 = (s0.match(/\d+(?:\.\d+)?%?/g) || []).map((x) => x.trim());
      const no = (so.match(/\d+(?:\.\d+)?%?/g) || []).map((x) => x.trim());
      return n0.length > 0 && no.length > 0 && n0[0] === no[0];
    })());

    const lvl = isNone ? -1
      : isPrimaryPub ? 0
      : isCitedUnconfirmed ? 2
      : isUncited ? 1
      : isDisputed ? 4
      : (DRIFT_LEVEL[f.code] ?? 2);

    const segW = (LW - 48 - 16) / 5;
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = (!isNone && i <= lvl) ? toneColor : p.line;
      drawRoundRect(ctx, LX + 24 + i * (segW + 4), driftY, segW, 6, 3);
      ctx.fill();
    }

    ctx.fillStyle = p.muted;
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    const origStr = f.origin
      ? `Earliest: ${f.origin.host} (${displayDate(f.origin)})`
      : 'Earliest: none reached';
    ctx.fillText(origStr, LX + 24, driftY + 18);

    const startHop = f.chain?.[0];
    const startStr = startHop ? `Start page: ${startHop.host} (${displayDate(startHop)})` : '';
    ctx.fillText(startStr, LX + 24, driftY + 32);

    const checkedStr = `What was checked: ${fetches} opened · ${f.stats?.searches || 0} searches · ${rejected} rejected`;
    ctx.fillText(checkedStr, LX + 24, driftY + 46);

    ctx.textAlign = 'right';
    ctx.fillStyle = toneColor;
    ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
    const driftText = isNone ? 'No original source'
      : isPrimaryPub ? 'Primary publisher (1/5)'
      : isCitedUnconfirmed ? 'Cited, not confirmed'
      : (isDisputed || numbersEqual) ? 'Disputed'
      : isUncited ? 'Uncited (2/5)'
      : `Drift ${lvl + 1}/5`;
    ctx.fillText(driftText, LX + LW - 24, driftY + 18);
    ctx.textAlign = 'left';

    // Right column: Vertical rail & hops
    const RX = LX + LW + 24;
    const RW = W - PAD - RX;
    const RAIL_X = RX + 14;
    const HCARD_X = RX + 34;
    const HCARD_W = RW - 34;

    ctx.fillStyle = p.muted;
    ctx.font = 'bold 11.5px system-ui, -apple-system, sans-serif';
    ctx.fillText('VERTICAL TRAIL  \u00B7  VERBATIM QUOTES & BREAKS', RX, COL_TOP + 12);

    const hops = (f.chain || []).slice(0, 4);
    if (!hops.length) {
      drawRoundRect(ctx, RX, COL_TOP + 26, RW, 140, 8);
      ctx.fillStyle = p.panel;
      ctx.fill();
      ctx.strokeStyle = p.line;
      ctx.stroke();
      ctx.fillStyle = p.ink;
      ctx.font = 'bold 15px Georgia, serif';
      ctx.fillText('No verified source hops available.', RX + 20, COL_TOP + 68);
    } else {
      const topY = COL_TOP + 26;
      const availH = COL_H - 26;
      const gap = 14;
      const maxCardH = Math.min(148, Math.floor((availH - gap * (hops.length - 1)) / hops.length));
      const maxQuoteLines = maxCardH >= 130 ? 4 : maxCardH >= 106 ? 3 : 2;

      let hy = topY;
      hops.forEach((hop, idx) => {
        ctx.font = '13.5px Georgia, serif';
        const qLines = ellipsizeLines(wrapTokens(ctx, hopTokens(hop), HCARD_W - 28), maxQuoteLines);
        const cardH = Math.max(82, Math.min(maxCardH, 46 + qLines.length * 19 + 14));
        const next = hops[idx + 1];

        if (next) {
          ctx.save();
          ctx.beginPath();
          ctx.lineWidth = 2.2;
          if (hop.changedHere) {
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = p.bad;
          } else {
            ctx.strokeStyle = p.rail;
          }
          ctx.moveTo(RAIL_X, hy + 20);
          ctx.lineTo(RAIL_X, hy + cardH + gap + 18);
          ctx.stroke();
          ctx.restore();
        }

        // Rail dot or origin square
        ctx.beginPath();
        const nodeColor = hop.dispute ? p.bad : hop.role === 'origin' ? p.ok : (hop.changedHere ? p.bad : toneColor);
        ctx.fillStyle = nodeColor;
        if (hop.role === 'origin') {
          ctx.fillRect(RAIL_X - 6, hy + 13, 12, 12);
        } else {
          ctx.arc(RAIL_X, hy + 19, 6, 0, Math.PI * 2);
          ctx.fill();
        }

        // Hop card
        drawRoundRect(ctx, HCARD_X, hy, HCARD_W, cardH, 8);
        ctx.fillStyle = p.panel;
        ctx.fill();
        ctx.strokeStyle = hop.changedHere || hop.dispute ? p.bad : p.line;
        ctx.lineWidth = hop.changedHere || hop.dispute ? 1.5 : 1;
        ctx.stroke();
        ctx.lineWidth = 1;

        ctx.fillStyle = p.ink;
        ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
        ctx.fillText(`${originLabel(hop)}  (${displayDate(hop)})`, HCARD_X + 14, hy + 22);

        if (hop.changedHere) {
          const isDispHop = Boolean(hop.disputedHere || hop.dispute || f.code === 'DISPUTED' || f.code === 'CONTRADICTED');
          ctx.fillStyle = p.bad;
          ctx.textAlign = 'right';
          ctx.font = 'bold 10.5px system-ui, -apple-system, sans-serif';
          ctx.fillText(isDispHop ? 'DISPUTED HERE' : 'CHANGED HERE', HCARD_X + HCARD_W - 14, hy + 22);
          ctx.textAlign = 'left';
        } else if (hop.sourceKindLabel && hop.role !== 'start') {
          ctx.fillStyle = p.muted;
          ctx.textAlign = 'right';
          ctx.font = '11px system-ui, -apple-system, sans-serif';
          ctx.fillText(hop.sourceKindLabel.slice(0, 30), HCARD_X + HCARD_W - 14, hy + 22);
          ctx.textAlign = 'left';
        }

        // Verbatim quote with highlighted changed words
        ctx.font = '13.5px Georgia, serif';
        const spaceW = ctx.measureText(' ').width;
        let qy = hy + 46;
        for (const line of qLines) {
          let qx = HCARD_X + 14;
          for (const tok of line) {
            const w = ctx.measureText(tok.text).width;
            if (tok.changed) {
              ctx.fillStyle = p.mark;
              ctx.fillRect(qx - 2, qy - 12, w + 4, 16);
            }
            ctx.fillStyle = tok.changed ? p.ink : p.muted;
            ctx.fillText(tok.text, qx, qy);
            qx += w + spaceW;
          }
          qy += 19;
        }

        hy += cardH + gap;
      });
    }

    // Footer divider & required caption
    ctx.strokeStyle = p.line;
    ctx.beginPath();
    ctx.moveTo(PAD, H - 50);
    ctx.lineTo(W - PAD, H - 50);
    ctx.stroke();

    ctx.fillStyle = p.ink;
    ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
    ctx.fillText('Traced with Source Hunter and TinyFish', PAD, H - 24);
    ctx.textAlign = 'right';
    ctx.fillStyle = p.muted;
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText('Every quote verified verbatim from fetched page text', W - PAD, H - 24);
    ctx.textAlign = 'left';

    return canvas;
  }

  function exportPng(f, payload, dark) {
    const canvas = renderCanvas(f, payload, dark);
    const a = document.createElement('a');
    a.download = `source-hunter-trail-${(f.code || 'card').toLowerCase()}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  }

  return { formatCitationText, exportPng, renderCanvas };
})();
