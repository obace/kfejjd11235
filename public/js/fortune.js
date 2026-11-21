(() => {
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) {
    try { tg.ready(); tg.expand(); } catch (_) {}
  }
  const initData = tg && tg.initData ? tg.initData : '';
  const btnBack = document.getElementById('btnBackPanel');
  if (btnBack && initData) {
    btnBack.style.display = 'none';
  }

  let toastTimer = null;
  function toast(msg, ms = 2600) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function formatBytes(bytes) {
    if (bytes < 0) return '∞ (无限)';
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
  }

  async function api(url) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    });
    return r.json();
  }

  const stageUnbound = document.getElementById('stageUnbound');
  const stageDraw = document.getElementById('stageDraw');
  const stageResult = document.getElementById('stageResult');
  const actBar = document.getElementById('actBar');
  const btnDraw = document.getElementById('btnDraw');
  const cylinderBox = document.getElementById('cylinderBox');

  function renderResult(rec, isJustDrawn) {
    stageUnbound.classList.add('hidden');
    stageDraw.classList.add('hidden');
    actBar.classList.add('hidden');
    stageResult.classList.remove('hidden');

    document.getElementById('curMonth').textContent = rec.month;
    document.getElementById('curRemaining').textContent = rec.afterRemainingBytes < 0
      ? '∞ (无限)'
      : formatBytes(rec.afterRemainingBytes);
    document.getElementById('curStatus').textContent = `已求签（${rec.levelName}）`;

    document.getElementById('resBadge').textContent = `${rec.badge} · ${rec.rateLabel}`;
    document.getElementById('resTitle').textContent = `「${rec.title}」`;
    document.getElementById('resPoem').textContent = rec.poem;

    const statsEl = document.getElementById('resStats');
    if (rec.beforeRemainingBytes < 0) {
      statsEl.innerHTML =
        `<div class="s-row"><span>求签月份</span><b>${rec.month}</b></div>` +
        `<div class="s-row total"><span>当前剩余流量</span><b>∞ (无限流量)</b></div>`;
    } else {
      statsEl.innerHTML =
        `<div class="s-row"><span>求签前剩余流量</span><b>${formatBytes(rec.beforeRemainingBytes)}</b></div>` +
        `<div class="s-row" style="color:#fde047"><span>灵签流量加成 (${rec.rateLabel})</span><b>+${formatBytes(rec.bonusBytes)}</b></div>` +
        `<div class="s-row total"><span>求签后剩余流量</span><b>${formatBytes(rec.afterRemainingBytes)}</b></div>`;
    }

    document.getElementById('resNote').textContent = isJustDrawn
      ? '🎉 灵签加持已生效！每月限求 1 次，下月 1 日 00:00 重置'
      : `✨ 你在 ${rec.month} 月已求过签，每月 1 日 00:00 重置求签次数`;
  }

  async function loadState() {
    try {
      const d = await api('/farm/api/fortune/state');
      if (!d.ok) {
        if (d.unboundTg) {
          document.getElementById('curStatus').textContent = '未绑定 TG';
          document.getElementById('curRemaining').textContent = '-';
          stageUnbound.classList.remove('hidden');
          stageDraw.classList.add('hidden');
          stageResult.classList.add('hidden');
          actBar.classList.add('hidden');
          return;
        }
        toast(d.error || '加载失败');
        return;
      }

      document.getElementById('curMonth').textContent = d.month;
      document.getElementById('curRemaining').textContent = d.infinite
        ? '∞ (无限)'
        : formatBytes(d.remainingBytes || 0);

      if (d.drawn && d.record) {
        renderResult(d.record, false);
      } else {
        document.getElementById('curStatus').textContent = '本月可求签 (剩 1 次)';
        stageUnbound.classList.add('hidden');
        stageResult.classList.add('hidden');
        stageDraw.classList.remove('hidden');
        actBar.classList.remove('hidden');
      }
    } catch (e) {
      toast('网络错误，请刷新重试');
    }
  }

  let drawing = false;
  async function doDraw() {
    if (drawing) return;
    drawing = true;
    if (btnDraw) {
      btnDraw.disabled = true;
      btnDraw.textContent = '🏮 正在摇签祈福...';
    }
    if (cylinderBox) cylinderBox.classList.add('shaking');

    try {
      const [d] = await Promise.all([
        api('/farm/api/fortune/draw'),
        new Promise(r => setTimeout(r, 1200)),
      ]);
      if (!d.ok) {
        if (d.alreadyDrawn && d.record) {
          renderResult(d.record, false);
        } else {
          toast(d.error || '求签失败', 3500);
        }
        return;
      }
      if (tg && tg.HapticFeedback) {
        try { tg.HapticFeedback.notificationOccurred('success'); } catch (_) {}
      }
      renderResult(d.record, true);
      toast(`🎉 抽中【${d.record.levelName}·${d.record.title}】！`);
    } catch (e) {
      toast('网络错误，请稍后重试');
    } finally {
      if (cylinderBox) cylinderBox.classList.remove('shaking');
      if (btnDraw) {
        btnDraw.disabled = false;
        btnDraw.textContent = '🏮 诚心摇签（本月限 1 次）';
      }
      drawing = false;
    }
  }

  if (btnDraw) btnDraw.addEventListener('click', doDraw);
  if (cylinderBox) cylinderBox.addEventListener('click', doDraw);

  loadState();
})();
