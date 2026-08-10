import { gzipSync } from "node:zlib";

const FIXED_DOS_DATE = 0x0021; // 1980-01-01, the earliest ZIP timestamp.

function normalizedEntries(entries) {
  const seen = new Set();
  return entries.map((entry) => {
    const archivePath = String(entry.path || "").replaceAll("\\", "/");
    if (!archivePath || archivePath.startsWith("/") ||
        archivePath.split("/").includes("..")) {
      throw new Error(`Unsafe archive path ${JSON.stringify(archivePath)}`);
    }
    if (seen.has(archivePath)) throw new Error(`Duplicate archive path ${archivePath}`);
    seen.add(archivePath);
    return {
      path: archivePath,
      data: Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data),
      mode: Number(entry.mode) || 0o100644
    };
  }).sort((left, right) => left.path.localeCompare(right.path, "en"));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export async function createZip(entries) {
  const { deflateRawSync } = await import("node:zlib");
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of normalizedEntries(entries)) {
    const name = Buffer.from(entry.path, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(FIXED_DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(FIXED_DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((entry.mode & 0xffff) * 0x10000, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  const entryCount = entries.length;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function writeTarString(header, value, offset, length) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new Error(`Tar field is too long: ${value}`);
  bytes.copy(header, offset);
}

function writeTarOctal(header, value, offset, length) {
  const encoded = Math.max(0, Number(value) || 0).toString(8).padStart(length - 1, "0");
  if (encoded.length >= length) throw new Error(`Tar numeric field is too large: ${value}`);
  writeTarString(header, `${encoded}\0`, offset, length);
}

function tarHeader(entry) {
  const header = Buffer.alloc(512);
  const pathBytes = Buffer.byteLength(entry.path);
  if (pathBytes > 100) throw new Error(`Tar path is too long: ${entry.path}`);
  writeTarString(header, entry.path, 0, 100);
  writeTarOctal(header, entry.mode & 0o777, 100, 8);
  writeTarOctal(header, 0, 108, 8);
  writeTarOctal(header, 0, 116, 8);
  writeTarOctal(header, entry.data.length, 124, 12);
  writeTarOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeTarString(header, "ustar\0", 257, 6);
  writeTarString(header, "00", 263, 2);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const encodedChecksum = checksum.toString(8).padStart(6, "0");
  writeTarString(header, `${encodedChecksum}\0 `, 148, 8);
  return header;
}

export function createTarGzip(entries) {
  const parts = [];
  for (const entry of normalizedEntries(entries)) {
    parts.push(tarHeader(entry), entry.data);
    const remainder = entry.data.length % 512;
    if (remainder) parts.push(Buffer.alloc(512 - remainder));
  }
  parts.push(Buffer.alloc(1024));
  const compressed = gzipSync(Buffer.concat(parts), { level: 9, mtime: 0 });
  compressed[9] = 0xff; // Normalize the gzip operating-system marker.
  return compressed;
}
