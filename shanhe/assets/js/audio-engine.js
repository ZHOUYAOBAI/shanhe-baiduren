/* ============================================================
   《山河摆渡人》· 音频引擎
   ------------------------------------------------------------
   目标一句话：**点下去就有声，而且一路不卡。**

   上一版做法是「整首曲子先完整下完，再交给 <audio> 播」。
   好处：播放期间完全不碰网络，绝不会卡。
   坏处：**开机是哑的** —— 2MB 的曲子要先等 4~20 秒才出声，
        等不及的人会以为坏了，又点一下，反而更乱。

   这一版改成「先出声，后备底」：
     ① 先让浏览器**原生流式**播第一条线路 → 第一秒就有声。
        音频已压到 80kbps（实时只要 10KB/s），带宽够就一路顺到底。
     ② 同时**低优先级**把整首下下来存进 Cache Storage。
        下完之后这一首就躺在本地，下次播放零网络、绝对不卡。
     ③ 看门狗盯着播放位置，**卡住 4 秒自动换下一条线路**，
        换源后从原位置接着播 —— 这就是「关键时刻换播放方案」。
     ④ 线路顺序按国内实测排：
        jsDelivr（带中国 CDN）→ Cloudflare 镜像 → 同源 → raw 兜底。

   这一层只管「网络与缓存」；播不播、界面怎么变，在 main.js 里。
   ============================================================ */

/* 缓存分区名。改了音频内容就换名字，旧缓存自然作废。 */
const CACHE_NAME = 'shanhe-audio-v3';

/* 重新排名的节奏 */
const TICK_MS = 1200;

/* 同时最多保留几条线路（其余掐断） */
const KEEP_ALIVE = 2;

/* 整体超时：所有线路加起来最多给 60 秒 */
const TOTAL_TIMEOUT = 60000;

/* 后台预热时单条线路的上限：挂住的线路不能把整串预热堵死 */
const WARM_LINE_TIMEOUT = 15000;

/* 分块并行下载：最多同时切几块 */
const CHUNKS = 8;

/* 每块至少这么多字节才值得单独发一个请求 */
const CHUNK_MIN = 192 * 1024;

const hasCacheAPI = (typeof caches !== 'undefined') && typeof caches.open === 'function';

export class AudioEngine {
  /**
   * @param {object} opt
   * @param {(file:string)=>string[]} opt.sources  该曲子的候选线路（URL 数组）
   * @param {(file:string, info:{loaded:number,total:number,ratio:number,url:string})=>void} [opt.onProgress]
   * @param {(file:string, stage:string)=>void} [opt.onStage]
   * @param {string} [opt.cacheName]
   */
  constructor(opt = {}) {
    this.sources = opt.sources || (() => []);
    this.onProgress = opt.onProgress || (() => {});
    this.onStage = opt.onStage || (() => {});
    this.cacheName = opt.cacheName || CACHE_NAME;

    this._cache = null;
    this._pending = new Map();   // file -> Promise<{url,blob,cached,source}>
    this._jobs = new Map();      // file -> Set<AbortController>
    this._warm = new Map();      // file -> Promise<{url,blob}>（后台缓存预热）
    this._blobs = new Map();     // file -> blob URL（同一首只创建一次，省内存）
    this._chunked = new Map();   // file -> Promise<Blob|null>（分块并行下载）
    this._blobTask = new Map();  // file -> Promise<Blob>（整首进内存）
  }

  /* ── 候选线路：补成绝对地址并去重 ──────────────────────
     同源线路和 Cloudflare 镜像在 Cloudflare 站上是同一个 URL，
     不去重就会对同一个文件下两遍，白白吃掉一倍带宽。 */
  lines(file) {
    const raw = (this.sources(file) || []).filter(Boolean);
    const abs = raw.map((u) => {
      try { return new URL(u, location.href).href; } catch (_) { return u; }
    });
    return [...new Set(abs)];
  }

  /* ── 掐断某首曲子的下载 ────────────────────────────────
     用户点了别的曲子时，后台预取就别再抢带宽了。 */
  cancel(file) {
    const set = this._jobs.get(file);
    if (set) {
      for (const c of set) { try { c.abort(); } catch (_) {} }
    }
    this._jobs.delete(file);
  }

  /* 只保留某首曲子的下载，其余全部掐断 */
  cancelExcept(file) {
    for (const key of [...this._jobs.keys()]) {
      if (key !== file) this.cancel(key);
    }
  }

  /* 现在有没有在下载（用来避免同时开太多条下载） */
  busy() {
    return this._jobs.size > 0;
  }

  /* ── Cache Storage ───────────────────────────────────── */
  async _cacheStore() {
    if (!hasCacheAPI) return null;
    if (!this._cache) {
      try {
        this._cache = await caches.open(this.cacheName);
      } catch (_) {
        this._cache = null;       // 隐私模式等场景，静默降级
      }
    }
    return this._cache;
  }

  /* 缓存里有这首吗？命中就直接给内存地址，零网络。 */
  async cacheHit(file) {
    const memo = this._blobs.get(file);
    if (memo) return { url: memo, blob: null, cached: true };
    const cache = await this._cacheStore();
    if (!cache) return null;
    try {
      const hit = await cache.match(file);
      if (!hit) return null;
      const blob = await hit.blob();
      if (!blob || !blob.size) return null;
      const url = URL.createObjectURL(blob);
      this._blobs.set(file, url);
      return { url, blob, cached: true };
    } catch (_) {
      return null;
    }
  }

  /* ── 整首拿到内存里（Blob）──────────────────────────────
     顺序：缓存 → 分块并行 → 整首竞速。
     拿到内存版之后，播放期间完全不碰网络（不卡），拖进度条也稳。 */
  blobOf(file) {
    if (this._blobTask.has(file)) return this._blobTask.get(file);
    const p = this._blobOf(file).finally(() => { this._blobTask.delete(file); });
    this._blobTask.set(file, p);
    return p;
  }

  async _blobOf(file) {
    /* 1) 缓存里有 */
    const cached = await this._cachedBlob(file);
    if (cached) {
      this.onStage(file, 'cached');
      return cached;
    }

    this.onStage(file, 'downloading');

    /* 2) 分块并行（最快）；服务器不支持 Range 就走不了这条路 */
    let blob = null;
    try {
      blob = await this._chunkedAll(file);
    } catch (_) { blob = null; }

    /* 3) 退回整首竞速：谁先下完用谁 */
    if (!blob) {
      const r = await this._race(file, this.lines(file));
      blob = r.blob;
    }

    if (!blob || !blob.size) throw new Error('下载失败');
    await this._store(file, blob);
    const old = this._blobs.get(file);
    if (old) { try { URL.revokeObjectURL(old); } catch (_) {} }
    this._blobs.set(file, URL.createObjectURL(blob));
    this.onStage(file, 'ready');
    return blob;
  }

  /* 缓存里的整首（Blob + 内存地址） */
  async _cachedBlob(file) {
    const memo = this._blobs.get(file);
    if (memo) return { blob: null, url: memo };
    const cache = await this._cacheStore();
    if (!cache) return null;
    try {
      const hit = await cache.match(file);
      if (!hit) return null;
      const blob = await hit.blob();
      if (!blob || !blob.size) return null;
      const url = URL.createObjectURL(blob);
      this._blobs.set(file, url);
      return { blob, url };
    } catch (_) {
      return null;
    }
  }

  /* ── 并行分块下载：整首曲子最快的一次拿法 ─────────────
     单条线路再快也就几百 KB/s；拆成 8 块同时下，速度就是 8 倍。
     这是「点下去一两秒就出声」的关键。
     需要服务器支持 Range（回 206）；不支持的线路自动出局，
     最后由整首下载兜底。 */
  chunked(file) {
    if (this._chunked.has(file)) return this._chunked.get(file);
    const p = this._chunkedAll(file).finally(() => { this._chunked.delete(file); });
    this._chunked.set(file, p);
    return p;
  }

  async _chunkedAll(file) {
    const lines = this.lines(file);

    /* ① 哪些线路支持 Range（并行探测，各取 2 个字节就够） */
    const probed = await Promise.all(lines.map((u) => this._probeRange(u)));
    const capable = probed.filter(Boolean);
    if (!capable.length) return null;

    /* ② 总大小：HEAD 的 Content-Length 是 CORS 安全头，一定读得到 */
    const total = await this._size(capable);
    if (!total) return null;

    /* ③ 切块并行下 */
    const count = Math.min(CHUNKS, Math.max(1, Math.ceil(total / CHUNK_MIN)));
    const step = Math.ceil(total / count);
    const parts = new Array(count);
    let loaded = 0;
    let broken = false;
    await Promise.all(Array.from({ length: count }, (_, i) => (async () => {
      const start = i * step;
      const end = Math.min(total - 1, (i + 1) * step - 1);
      const buf = await this._fetchRange(capable, start, end);
      if (!buf) { broken = true; return; }
      parts[i] = buf;
      loaded += buf.byteLength;
      this.onProgress(file, {
        loaded, total,
        ratio: Math.min(1, loaded / total),
        url: capable[i % capable.length],
      });
    })()));
    if (broken) return null;

    const blob = new Blob(parts, { type: 'audio/mpeg' });
    if (!blob.size) return null;
    return blob;
  }

  /* 这条线路支持 Range 吗？（回 206 才算） */
  async _probeRange(url) {
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-1' }, priority: 'low' });
      const ok = res.status === 206;
      try { res.body && res.body.cancel(); } catch (_) {}
      return ok ? url : null;
    } catch (_) {
      return null;
    }
  }

  /* 总大小：HEAD 拿不到就换下一条 */
  async _size(urls) {
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        const n = Number(res.headers.get('content-length')) || 0;
        if (n > 0) return n;
      } catch (_) { /* 换下一条 */ }
    }
    return 0;
  }

  /* 取一段字节；这条线路不给 206 就换下一条 */
  async _fetchRange(urls, start, end) {
    const want = end - start + 1;
    for (const url of urls) {
      try {
        const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
        if (res.status !== 206) {
          try { res.body && res.body.cancel(); } catch (_) {}
          continue;                       // 这条线路不支持 Range
        }
        const buf = await res.arrayBuffer();
        if (buf.byteLength === want) return buf;
      } catch (_) { /* 换下一条 */ }
    }
    return null;
  }

  /* ── 后台预热：把整首低优先级下下来存进缓存 ───────────
     skipUrl：正在播的那条线路别重复占用（同一条线两个连接会互相拖慢）。
     不抛错：预热失败不影响正在播的那一份。 */
  warm(file, skipUrl = '') {
    if (this._warm.has(file)) return this._warm.get(file);
    const p = this._warmAll(file, skipUrl)
      .finally(() => { this._warm.delete(file); });
    this._warm.set(file, p);
    return p;
  }

  async _warmAll(file, skipUrl) {
    const urls = this.lines(file).filter((u) => u !== skipUrl);
    if (!urls.length) throw new Error('无可用线路');

    this.onStage(file, 'downloading');
    /* 一条一条试：预热是后台的事，没必要四条线一起抢带宽 */
    let lastErr = null;
    for (const url of urls) {
      try {
        const blob = await this._downloadOne(url, file, 'low');
        await this._store(file, blob);
        const old = this._blobs.get(file);
        if (old) { try { URL.revokeObjectURL(old); } catch (_) {} }
        const memo = URL.createObjectURL(blob);
        this._blobs.set(file, memo);
        this.onStage(file, 'ready');
        return { url: memo, blob };
      } catch (err) {
        lastErr = err;
      }
    }
    this.onStage(file, 'failed');
    throw lastErr || new Error('所有线路都失败');
  }

  /* ── 对外：拿到一个「一定能直接播」的 URL ─────────────── */
  resolve(file) {
    if (this._pending.has(file)) return this._pending.get(file);
    const p = this._load(file).finally(() => { this._pending.delete(file); });
    this._pending.set(file, p);
    return p;
  }

  async _load(file) {
    /* 1. 缓存命中 → 秒开 */
    const hit = await this.cacheHit(file);
    if (hit) {
      this.onStage(file, 'cached');
      return { url: hit.url, blob: hit.blob, cached: true, source: 'cache' };
    }

    /* 2. 多源竞速，整首下完 */
    this.onStage(file, 'downloading');
    const r = await this._race(file, this.lines(file));

    /* 3. 存缓存，供下次秒开 */
    await this._store(file, r.blob);

    this.onStage(file, 'ready');
    return { url: URL.createObjectURL(r.blob), blob: r.blob, cached: false, source: r.url };
  }

  async _store(file, blob) {
    const cache = await this._cacheStore();
    if (!cache) return;
    try {
      await cache.put(file, new Response(blob, {
        headers: {
          'Content-Type': blob.type || 'audio/mpeg',
          'Content-Length': String(blob.size),
        },
      }));
    } catch (_) { /* 存不进去不影响本次播放 */ }
  }

  /* ── 竞速：谁先跑完谁赢 ───────────────────────────────── */
  _race(file, urls) {
    const stats = new Map();   // url -> { loaded, total }
    const ctrls = new Map();   // url -> AbortController
    const jobs = [];

    const mine = this._jobs.get(file) || new Set();
    this._jobs.set(file, mine);

    for (const url of urls) {
      const ctrl = new AbortController();
      ctrls.set(url, ctrl);
      mine.add(ctrl);
      stats.set(url, { loaded: 0, total: 0 });
      jobs.push(this._pull(url, file, ctrl.signal, stats, 'auto'));
    }

    /* 定期淘汰落后线路：只留最快的 KEEP_ALIVE 条 */
    const timer = setInterval(() => {
      const ranked = [...stats.entries()]
        .map(([url, s]) => ({ url, loaded: s.loaded }))
        .sort((a, b) => b.loaded - a.loaded);
      if (!ranked.length) return;
      const keep = new Set(ranked.slice(0, KEEP_ALIVE).map(x => x.url));
      const lead = ranked[0].loaded;
      for (const [url, ctrl] of ctrls) {
        if (keep.has(url)) continue;
        const s = stats.get(url);
        /* 落后太多才掐断，避免误杀「刚起步但很快」的线路 */
        if (s.loaded <= lead * 0.3) {
          try { ctrl.abort(); } catch (_) {}
        }
      }
    }, TICK_MS);

    return new Promise((resolve, reject) => {
      let left = jobs.length;
      let lastErr = null;
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        clearInterval(timer);
        clearTimeout(timeout);
        this._jobs.delete(file);
      };

      const timeout = setTimeout(() => {
        for (const ctrl of ctrls.values()) { try { ctrl.abort(); } catch (_) {} }
        finish();
        reject(new Error('下载超时'));
      }, TOTAL_TIMEOUT);

      jobs.forEach((job) => job.then((r) => {
        if (done) return;
        if (r.ok) {
          /* 赢家诞生 → 立刻掐断其余线路，不浪费用户带宽 */
          for (const [url, ctrl] of ctrls) {
            if (url !== r.url) { try { ctrl.abort(); } catch (_) {} }
          }
          finish();
          resolve(r);
        } else {
          lastErr = r.err;
          left -= 1;
          if (left === 0) {
            finish();
            reject(lastErr || new Error('所有线路都失败'));
          }
        }
      }));
    });
  }

  /* ── 单条线路的下载 ──────────────────────────────────── */
  async _pull(url, file, signal, stats, priority) {
    const st = stats.get(url);
    try {
      const res = await fetch(url, { signal, priority });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = (res.headers.get('content-type') || 'audio/mpeg').split(';')[0];
      st.total = Number(res.headers.get('content-length')) || 0;

      let blob;
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || !value.length) continue;
          chunks.push(value);
          st.loaded += value.length;
          this._report(file, stats);
        }
        blob = new Blob(chunks, { type: ct });
      } else {
        blob = await res.blob();
        st.loaded = blob.size;
      }

      if (!blob || !blob.size) throw new Error('空文件');
      st.total = st.total || blob.size;
      return { ok: true, url, blob, total: st.total };
    } catch (err) {
      return { ok: false, url, err };
    }
  }

  /* 只下一条线（后台预热用）。
     ⚠️ 必须带超时：某条线路挂住不返回时，不能让它把整串预热都堵死。 */
  async _downloadOne(url, file, priority) {
    const ctrl = new AbortController();
    const mine = this._jobs.get(file) || new Set();
    this._jobs.set(file, mine);
    mine.add(ctrl);
    const timer = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, WARM_LINE_TIMEOUT);
    try {
      const res = await fetch(url, { signal: ctrl.signal, priority });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = (res.headers.get('content-type') || 'audio/mpeg').split(';')[0];
      const total = Number(res.headers.get('content-length')) || 0;

      let blob;
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks = [];
        let loaded = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || !value.length) continue;
          chunks.push(value);
          loaded += value.length;
          this.onProgress(file, {
            loaded, total,
            ratio: total ? Math.min(1, loaded / total) : 0,
            url,
          });
        }
        blob = new Blob(chunks, { type: ct });
      } else {
        blob = await res.blob();
      }
      if (!blob || !blob.size) throw new Error('空文件');
      return blob;
    } finally {
      clearTimeout(timer);
      mine.delete(ctrl);
      if (!mine.size) this._jobs.delete(file);
    }
  }

  /* ── 只汇报「当前领先的那条线」的进度 ─────────────────── */
  _report(file, stats) {
    let lead = null;
    for (const [url, s] of stats) {
      if (!lead || s.loaded > lead.loaded) lead = { url, ...s };
    }
    if (!lead) return;
    const ratio = lead.total ? Math.min(1, lead.loaded / lead.total) : 0;
    this.onProgress(file, {
      loaded: lead.loaded,
      total: lead.total,
      ratio,
      url: lead.url,
    });
  }

  /* ── 清缓存（调试用） ─────────────────────────────────── */
  async clearCache() {
    if (!hasCacheAPI) return;
    try { await caches.delete(this.cacheName); } catch (_) {}
    this._cache = null;
  }
}
