/* ============================================================
   剧本站 · 剧本结构标记（解析层与校验层共用）
   ------------------------------------------------------------
   解析层（parse-script.mjs）与校验层（audit.mjs）必须对「什么算结构标签」
   有一致的判断，否则会出现「解析时跳过了、校验时又要求上站」的错位。
   两处定义集中在此，避免定义漂移。
   ============================================================ */

/* 附录标题：人物表 / 角色表 / 曲目表 ……
   其后的正文按附录处理（表格仍入库，普通段落跳过） */
export const APPENDIX_HEADING_RE =
  /^(人物表|人物介绍|角色表|角色介绍|演员表|演员阵容|曲目表|歌目表|道具表|场景表|场次表|附\s*录|附录)\s*$/;

/* 场次标题：第一场：邮局后院 / 第二场·二十年后
   —— 剧本用「场」而非「幕」时，场次即章节 */
export const SCENE_HEADING_RE =
  /^(?:第\s*[一二三四五六七八九十百零两\d]+\s*[场节折]|场\s*[一二三四五六七八九十百零两\d]+)\s*[：:·、.．]?\s*\S+/;

/* 曲目标题：第 1 首《血绢誓·序曲》｜苏云 女高音
   —— 「第 N 首《曲名》」是国产歌剧/音乐剧剧本最常见的写法 */
export const SONG_NO_TITLE_RE =
  /^第\s*([0-9０-９一二三四五六七八九十百零两]+)\s*首\s*[《「『](.+?)[》」』]\s*(?:[｜|]\s*)?(.*)$/;

/* 场次表（幕表）表头：幕 | 场 | 时间 | 地点 | 时长 | … */
export const isSceneTableHead = (head) => {
  const j = (head || []).join('|');
  return /场/.test(j) && /时间/.test(j) && /地点/.test(j);
};

/* Markdown 风格的表格行 */
export const isTableLine = (line) => /^\s*\|/.test(String(line ?? ''));

/* 拆一行表格为单元格 */
export function splitTableRow(line) {
  return String(line ?? '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/* 分隔行（|---|---|）不是数据 */
export const isSeparatorRow = (cells) =>
  Array.isArray(cells) &&
  cells.length > 0 &&
  cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '');
