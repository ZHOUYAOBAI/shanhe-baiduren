/* ============================================================================
 *  realtime.js — 研读现场 · 实时协作层
 *  ---------------------------------------------------------------------------
 *  设计目标（与网站定位一致：给「想要排歌剧的专业人士」演示用）
 *    ① 传输无关：对外只暴露一个 RealtimeClient，内部可换通道。
 *    ② 默认 MockChannel：无需任何服务器，演示时屏幕就「活」着，
 *       在线人数浮动、专业研读批注实时滚入，看着像真的协作室。
 *    ③ 预留 SSE / WebSocket 通道：将来真接后端，只改 REALTIME_CONFIG 一处，
 *       前端渲染层一行不用动。
 *
 *  事件约定：
 *    'status'    'connecting' | 'live' | 'offline'
 *    'presence'  { online:Number, reading:Number }
 *    'note'      { id, who, role, act, text, ts }
 *    'join'      { who, role, ts }
 * ========================================================================== */
(function () {
  'use strict';

  /* ── 极简事件总线 ───────────────────────────────────────────── */
  function Emitter() {
    const map = new Map();
    return {
      on(type, fn) {
        if (!map.has(type)) map.set(type, []);
        map.get(type).push(fn);
        return () => this.off(type, fn);
      },
      off(type, fn) {
        const arr = map.get(type);
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i > -1) arr.splice(i, 1);
      },
      emit(type, payload) {
        (map.get(type) || []).forEach((fn) => {
          try { fn(payload); } catch (e) { console.error('[realtime]', e); }
        });
      }
    };
  }

  /* ── Mock 通道：模拟专业排演研读室的实时活动 ─────────────────── */
  const ROLES = ['导演', '声乐指导', '舞美', '编剧', '主演', '乐队', '文学策划', '场记'];
  const ACTS = ['序幕·茅屋', '第一幕·渡口', '第二幕·牢狱', '第三幕·刑场', '终幕·纪念馆'];
  const NOTES = [
    '这一段合唱的呼吸点，建议跟着马灯的明暗走。',
    '第二幕转场用一束定点光收住，不要满台亮。',
    '「薪火」的意象在终幕要回扣查尼皮那一盏灯。',
    '咏叹调的咬字再松一点，泥土气比学院腔更对。',
    '舞美上那条红绸，能不能换成更旧的麻布质感？',
    '这段念白和后台人声要分层，别糊在一起。',
    '纪念馆一场，灯要「不灭」，和开头那一盏呼应。',
    '调度上让群演从暗里浮出来，比站着唱更有重量。',
    '间奏里加一段口弦或树叶，云南乡土味就出来了。',
    '结尾字幕「马灯不灭，薪火永续」停留久一点。',
    '男主那段独白，气息从腹腔起，别用胸腔顶。',
    '终幕合唱的声部再厚一档，托住那句「回查尼皮」。'
  ];
  const SURNAMES = ['林', '周', '陈', '吴', '何', '郑', '罗', '高', '苏', '唐', '白', '严'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rid = () => Math.random().toString(36).slice(2, 8);

  function MockChannel(emitter, opts) {
    let timer = null;
    let lastNote = '';
    let online = 3 + Math.floor(Math.random() * 4);
    let reading = 1 + Math.floor(Math.random() * 2);
    const interval = (opts && opts.interval) || 4200;

    function tick() {
      online = Math.max(2, Math.min(24, online + pick([-1, 0, 0, 1])));
      reading = Math.max(1, Math.min(online, reading + pick([-1, 0, 1])));
      emitter.emit('presence', { online: online, reading: reading });

      if (Math.random() < 0.62) {
        /* 不与上一条批注重复 —— 连续重复一眼就看出是演示数据 */
        let text = pick(NOTES);
        for (let i = 0; i < 4 && text === lastNote; i++) text = pick(NOTES);
        lastNote = text;
        emitter.emit('note', {
          id: rid(),
          who: pick(SURNAMES) + '（' + pick(ROLES) + '）',
          role: pick(ROLES),
          act: pick(ACTS),
          text: text,
          ts: Date.now()
        });
      } else {
        emitter.emit('join', {
          who: pick(SURNAMES) + '（' + pick(ROLES) + '）',
          role: pick(ROLES),
          ts: Date.now()
        });
      }
    }

    return {
      name: 'mock',
      connect() {
        emitter.emit('status', 'connecting');
        setTimeout(() => {
          emitter.emit('status', 'live');
          emitter.emit('presence', { online: online, reading: reading });
          timer = setInterval(tick, interval);
        }, 600);
      },
      disconnect() {
        if (timer) clearInterval(timer);
        timer = null;
        emitter.emit('status', 'offline');
      }
    };
  }

  /* ── SSE 通道（占位，待接后端）──────────────────────────────── */
  function SSEChannel(emitter, opts) {
    let es = null;
    return {
      name: 'sse',
      connect() {
        emitter.emit('status', 'connecting');
        es = new EventSource(opts.url);
        es.onopen = () => emitter.emit('status', 'live');
        es.onerror = () => emitter.emit('status', 'offline');
        es.addEventListener('presence', (e) => emitter.emit('presence', JSON.parse(e.data)));
        es.addEventListener('note', (e) => emitter.emit('note', JSON.parse(e.data)));
        es.addEventListener('join', (e) => emitter.emit('join', JSON.parse(e.data)));
      },
      disconnect() {
        if (es) es.close();
        emitter.emit('status', 'offline');
      }
    };
  }

  /* ── WebSocket 通道（占位，待接后端）───────────────────────── */
  function WebSocketChannel(emitter, opts) {
    let ws = null;
    return {
      name: 'websocket',
      connect() {
        emitter.emit('status', 'connecting');
        ws = new WebSocket(opts.url);
        ws.onopen = () => emitter.emit('status', 'live');
        ws.onclose = () => emitter.emit('status', 'offline');
        ws.onmessage = (e) => {
          try {
            const m = JSON.parse(e.data);
            emitter.emit(m.type, m.payload);
          } catch (_) { /* 忽略非协议帧 */ }
        };
      },
      disconnect() {
        if (ws) ws.close();
        emitter.emit('status', 'offline');
      }
    };
  }

  function createClient(config) {
    config = config || {};
    const emitter = Emitter();
    let channel;
    if (config.channel === 'sse' && config.sseUrl) {
      channel = SSEChannel(emitter, { url: config.sseUrl });
    } else if (config.channel === 'websocket' && config.wsUrl) {
      channel = WebSocketChannel(emitter, { url: config.wsUrl });
    } else {
      channel = MockChannel(emitter, { interval: config.interval });
    }
    return {
      on: emitter.on,
      off: emitter.off,
      connect: () => channel.connect(),
      disconnect: () => channel.disconnect(),
      get channelName() { return channel.name; }
    };
  }

  /* ── 研读现场面板（DOM 渲染，与通道解耦）────────────────────── */
  function mountReaderRoom(config) {
    const dock = document.getElementById('rtRoom');
    const toggle = document.getElementById('rtToggle');
    const closeBtn = document.getElementById('rtClose');
    const feed = document.getElementById('rtFeed');
    const onlineEl = document.getElementById('rtOnline');
    const readingEl = document.getElementById('rtReading');
    const statusText = document.getElementById('rtStatusText');
    if (!dock || !feed || !toggle) return;

    const MAX_ITEMS = 30;
    let unseen = 0;

    const fmtTime = (ts) => {
      const d = new Date(ts);
      const p = (n) => String(n).padStart(2, '0');
      return p(d.getHours()) + ':' + p(d.getMinutes());
    };

    function addItem(kind, data) {
      const li = document.createElement('li');
      li.className = 'rt-item' + (kind === 'join' ? ' join' : '');

      const meta = document.createElement('div');
      meta.className = 'rt-meta';

      const role = document.createElement('span');
      role.className = 'rt-role';
      role.textContent = data.role || '研读';

      const act = document.createElement('span');
      act.className = 'rt-act';
      act.textContent = (kind === 'note' && data.act) ? '· ' + data.act : '· 进入研读室';

      const who = document.createElement('span');
      who.className = 'rt-who';
      who.textContent = fmtTime(data.ts);

      meta.appendChild(role);
      meta.appendChild(act);
      meta.appendChild(who);

      const text = document.createElement('div');
      text.className = 'rt-text';
      if (kind === 'note') {
        text.textContent = data.text;
      } else {
        text.textContent = (data.who || '一位同行') + ' 进入研读室';
      }

      li.appendChild(meta);
      li.appendChild(text);
      feed.insertBefore(li, feed.firstChild);
      while (feed.children.length > MAX_ITEMS) {
        feed.removeChild(feed.lastChild);
      }
      if (!dock.classList.contains('open')) {
        unseen++;
        toggle.classList.add('has-unseen');
      }
    }

    const client = createClient(config);

    client.on('status', (s) => {
      dock.classList.toggle('live', s === 'live');
      toggle.classList.toggle('live', s === 'live');
      if (statusText) statusText.textContent =
        s === 'live' ? '实时连接' : (s === 'connecting' ? '连接中…' : '已离线');
    });
    client.on('presence', (p) => {
      if (onlineEl) onlineEl.textContent = p.online;
      if (readingEl) readingEl.textContent = p.reading + ' 人正在读';
    });
    client.on('note', (n) => addItem('note', n));
    client.on('join', (j) => addItem('join', j));

    function openRoom() {
      dock.classList.add('open');
      dock.setAttribute('aria-hidden', 'false');
      toggle.setAttribute('aria-pressed', 'true');
      toggle.classList.remove('has-unseen');
      unseen = 0;
    }
    function closeRoom() {
      dock.classList.remove('open');
      dock.setAttribute('aria-hidden', 'true');
      toggle.setAttribute('aria-pressed', 'false');
    }
    toggle.addEventListener('click', () => {
      dock.classList.contains('open') ? closeRoom() : openRoom();
    });
    if (closeBtn) closeBtn.addEventListener('click', closeRoom);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dock.classList.contains('open')) closeRoom();
    });

    client.connect();
  }

  function boot() {
    const cfg = (window.REALTIME_CONFIG && typeof window.REALTIME_CONFIG === 'object')
      ? window.REALTIME_CONFIG : { channel: 'mock' };
    mountReaderRoom(cfg);
  }

  window.RealtimeClient = { create: createClient, mountReaderRoom: mountReaderRoom,
    MockChannel, SSEChannel, WebSocketChannel };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
