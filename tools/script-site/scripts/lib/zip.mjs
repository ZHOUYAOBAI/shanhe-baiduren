/* ============================================================
   极简 ZIP 读取器（只读，不依赖任何三方库）
   ------------------------------------------------------------
   用法：const zf = await readZip(path); const xml = zf.read('word/document.xml');
   支持 store(0) 与 deflate(8)。足够解析 .docx / .xlsx / .pptx。
   ============================================================ */
import fs from 'node:fs';
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEOCD(buf) {
  const max = Math.min(buf.length, 0xffff + 22);
  for (let i = buf.length - 22; i >= buf.length - max && i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * 读取 zip 文件。
 * @param {string} path
 * @returns {Promise<{names:string[], read:(name:string)=>string|null}>}
 */
export async function readZip(path) {
  const buf = fs.readFileSync(path);
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error('不是有效的 zip/docx 文件：' + path);

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== CEN_SIG) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.set(name, { method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }

  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (buf.readUInt32LE(e.localOff) !== LOC_SIG) return null;
      const lNameLen = buf.readUInt16LE(e.localOff + 26);
      const lExtraLen = buf.readUInt16LE(e.localOff + 28);
      const start = e.localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + e.compSize);
      if (e.method === 0) return raw.toString('utf8');
      if (e.method === 8) return zlib.inflateRawSync(raw).toString('utf8');
      throw new Error('不支持的压缩方式：' + e.method);
    },
  };
}
