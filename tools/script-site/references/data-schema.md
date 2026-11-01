# 数据契约

## 一、`site_meta.json`（人工撰写）

构建时传给 `build-site.mjs --meta`。**只有这里的内容需要人写**，其余全部自动。

### 剧目信息

| 字段 | 类型 | 说明 |
|---|---|---|
| `slug` | string | 短标识，用于密码盐值与部署路径（例：`shanhe`） |
| `name` | string | 剧名，HERO 大标题（例：`山河摆渡人`） |
| `title` | string | 浏览器标题与 og 标题（例：`云南本土原创红色歌剧《山河摆渡人》`） |
| `description` | string | meta description / og description |
| `kicker` | string | HERO 顶部小字（例：`云南本土原创红色歌剧`） |
| `seal` | string | 印章字，默认取 `name` 首字 |
| `theme` | string | 一句话题旨，显示在 HERO 与页脚 |
| `span` | string | 时间跨度（例：`1932年—1935年`） |
| `author` / `music` / `director` | string | 署名，显示在 HERO 与页脚 |
| `cta` | string | HERO 按钮文案，默认 `开演` |
| `scene` | string | 背景景别：`mountain` `river` `fire` `sea` `stage` `forest` |
| `motif` | string | HERO 的立体母题：`lantern`（默认，一盏 3D 马灯）／`none`（不要） |
| `mainline` | string[] | 主线脉络，逐条对应一个幕 |
| `note` | string | 史实/虚构声明，显示在页脚 |
| `footerTitle` | string | 页脚大标题，默认取 `theme` |

### 人工内容

| 字段 | 类型 | 说明 |
|---|---|---|
| `timeline` | `{act,date,label}[]` | 主线时间轴，`act` 为幕序号（0 起） |
| `threads` | `{name,color,plant,pay,note}[]` | 伏笔。`plant` = 埋在哪，`pay` = 在哪收，`note` = 一句点评 |
| `cast` | `{name,role,desc}[]` | 人物小传。剧本里没有人物表时用它生成 |
| `front` | `{title,tags[],paras[],tables[]}[]` | 创作总纲。剧本开头有「戏核 / 事件线 / 修订手记」时用，站点做成可展开卡片墙；带表格的卡片整行铺开 |
| `frontCount` | number | 总纲条目数。`front` 为空时只用于锁定态提示文案 |
| `sections` | object | 各区块标题覆盖，见下 |
| `palette` | object | 配色覆盖，见 `site-design.md`。键：`bg` `bg2` `bg3` `paper` `paper2` `paper3` `accent` `accentDeep` `accent2` `accent3`。`accentDeep` 是深朱砂（大面积实底用），缺省取 `#8A1E13` |
| `speakers` | string[] | 角色名白名单，确认过的角色写这里 |
| `actHeadings` | string[] | 哪些标题算「幕」（幕名不含「幕/序」时用） |
| `gate` | object | 权限门：`enabled` `title` `desc` `tip` |
| `audio` | `{title,file}[]` | 音频文件，构建时拷进 `assets/audio/` |

### `sections` 覆盖

`sections` 下每个键对应页面一个区块，值可含 `num`（眉标）、`title`（标题）、`desc`（说明）：

```json
"sections": {
  "spine":   { "num": "主 线", "title": "一条被历史记住的路", "desc": "…" },
  "songs":   { "num": "歌 单", "title": "全剧四十首",     "desc": "…" },
  "table":   { "num": "目 录", "title": "全剧曲目表",     "desc": "…" },
  "cast":    { "num": "人 物", "title": "十一个人，一条河", "desc": "…" },
  "threads": { "num": "伏 笔", "title": "六条线，都收了",  "desc": "…" },
  "front":   { "num": "总 纲", "title": "创作总纲 · 戏核",  "desc": "…", "lockedDesc": "本剧附有创作总纲 24 项。" },
  "gate":    { "title": "全本剧本 · 限内部传阅", "desc": "…", "tip": "…" }
}
```

不写 `sections` 时用默认措辞（歌单 / 目录 / 人物 / 伏笔 / 主线）。
对应数据为空时，区块自动隐藏。

## 二、`assets/js/data.js`（构建产物，勿手改）

```js
window.SCRIPT = {
  cover: {
    title, name, kicker, seal, theme, span,
    author, music, director, cta, scene,
    mainline: [...], note, footerTitle
  },
  acts: [
    {
      title: "序幕：火塘边",
      meta: { time, place, cast, mood: [...] },
      blocks: [                       // 公开层：只有结构
        { k: "scene", v: "第一场·晨雾" },
        { k: "song",  v: { no, name, performer, label, act, actTitle } }
      ]
    }
  ],
  songs:  [ { no, name, performer, label, act, actTitle } ],
  songTable: [ ["幕次","序号","曲目名称","类型","演唱"], [...] ],
  charTable:  [ ["人物","人物简介"], [...] ],
  threads: [ { name, color, plant, pay, note } ],
  front: [ { title, tags[], paras[], tables: [{ head[], rows[][] }] } ],
  frontCount: 0,
  timeline:[ { act, date, label } ],
  actLabels: ["序幕","第一幕","第二幕"],
  sections: { spine, songs, table, cast, threads, front, gate }
};

window.SCRIPT_SECRET = { salt, iterations, iv, cipher };   // 仅在设了密码时存在
```

`SCRIPT_SECRET` 解开后是：

```js
{
  acts:  [ { act: 0, blocks: [
      { k: "scene", v },
      { k: "dlg",  v: { who, cue, text } },
      { k: "sd",   v },
      { k: "song", v: { no, name, performer, label } },
      { k: "note", v }
  ] } ],
  songs: [ { no, lyrics, items: [
      { k: "ly",  speaker, cue, text },   // 唱词
      { k: "sec", v },                    // 曲内小节标题
      { k: "pt",  v },                    // 声部标注
      { k: "cue", v, who },               // 舞台提示
      { k: "head", v }                    // 曲目标题原文
  ] } ]
}
```

### 加密参数

| 项 | 值 |
|---|---|
| 密钥派生 | PBKDF2-HMAC-SHA256，150000 轮，32 字节密钥 |
| 加密 | AES-256-GCM，12 字节随机 IV |
| 盐值 | `base64("<slug>/read-salt")`，随密文一起存放 |

浏览器端用 WebCrypto 解密（`assets/js/crypto.js`），与构建端
（`scripts/build-data.mjs`，Node `crypto`）参数严格一致。改任一端必须同步改另一端。

## 三、`script_struct.json`（解析产物，中间文件）

存放在 `<站点>/working/`，**部署时被剔除**，不进公网仓库。

```js
{
  doc_title, source, format, generated_at,
  acts: [{ index, title, meta: {time,place,cast,mood[]}, blocks: [...] }],
  songs: [{ no, name, performer_raw, act, actTitle, items: [...] }],
  song_table: [[...]], char_table: [[...]], extra_tables: [[...]],
  style_notes: [...],           // 幕前的题记/体例说明
  speaker_candidates: [[name, count]],   // 按出现次数排序
  ambiguous_speakers: [...],   // 只出现一次、被按旁白处理的，疑似角色名
  log: [[idx, kind, text]]      // 每一段的判定记录，配合 --audit 排查
}
```

排查解析问题时先看 `log`：`SPK`=台词 `LY`=唱词 `SD`=舞台提示 `SCENE`=场次
`SONG`=曲段 `SEC`=曲内小节 `META`=幕首资料 `MOOD`=舞台氛围 `NOTE`=题记
`APPENDIX`=附录 `ACTLINE`=叙述 `SKIP`=附录区跳过。
