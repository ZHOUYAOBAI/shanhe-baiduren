/* ============================================================
   docx 解析（零依赖）
   ------------------------------------------------------------
   输出与剧本解析层一致的中间结构：
     { paragraphs: [{ style, text }], tables: [[cell, ...], ...] }
   表格以「出现顺序」夹在段落流里，用 { kind } 标记。
   ============================================================ */
import { readZip } from './zip.mjs';

/* XML → 纯文本（去掉标签，保留实体） */
function xmlToText(xml) {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/* 把扁平 XML 切成段落 / 表格块 */
function splitBlocks(xml) {
  const blocks = [];
  const re = /<w:(p|tbl)\b[^>]*>([\s\S]*?)<\/w:\1>|<w:(p|tbl)\b[^>]*\/>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) blocks.push({ kind: m[1], inner: m[2] });
    else blocks.push({ kind: m[3], inner: '' });
  }
  return blocks;
}

/* 段落样式名：w:pPr/w:pStyle/@w:val */
function paraStyle(inner) {
  const m = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(inner);
  return m ? m[1] : '';
}

/* 表格 → 二维数组 */
function tableRows(inner) {
  const rows = [];
  const re = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
  let rm;
  while ((rm = re.exec(inner)) !== null) {
    const cells = [];
    const cre = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
    let cm;
    while ((cm = cre.exec(rm[1])) !== null) {
      const texts = [];
      const tre = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
      let tm;
      while ((tm = tre.exec(cm[1])) !== null) texts.push(tm[1]);
      cells.push(decodeEntities(texts.join('')).trim());
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 读取 docx。
 * @param {string} path
 * @returns {Promise<{paragraphs:Array, blocks:Array}>}
 */
export async function readDocx(path) {
  const zf = await readZip(path);
  const xml = zf.read('word/document.xml');
  if (!xml) throw new Error('docx 缺少 word/document.xml：' + path);

  const blocks = splitBlocks(xml);
  const out = [];
  for (const b of blocks) {
    if (b.kind === 'p') {
      const texts = [];
      const tre = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
      let tm;
      while ((tm = tre.exec(b.inner)) !== null) texts.push(tm[1]);
      const text = decodeEntities(texts.join('')).trim();
      out.push({ kind: 'p', style: paraStyle(b.inner), text });
    } else {
      out.push({ kind: 't', rows: tableRows(b.inner) });
    }
  }
  return {
    paragraphs: out.filter((b) => b.kind === 'p').map((b) => ({ style: b.style, text: b.text })),
    blocks: out,
  };
}
