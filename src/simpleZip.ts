export type SimpleZipFile = {
  path: string;
  data: Buffer | string;
};

type CentralDirectoryRecord = {
  path: Buffer;
  data: Buffer;
  crc: number;
  localHeaderOffset: number;
};

const crcTable = createCrcTable();

export function createSimpleZipArchive(files: SimpleZipFile[], modifiedAt = new Date()): Buffer {
  const localParts: Buffer[] = [];
  const centralRecords: CentralDirectoryRecord[] = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime(modifiedAt);

  for (const file of files) {
    const path = Buffer.from(normalizeZipPath(file.path), "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
    const crc = crc32(data);
    const header = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0),
      uint16(0),
      uint16(dosTime),
      uint16(dosDate),
      uint32(crc),
      uint32(data.length),
      uint32(data.length),
      uint16(path.length),
      uint16(0),
      path
    ]);

    localParts.push(header, data);
    centralRecords.push({
      path,
      data,
      crc,
      localHeaderOffset: offset
    });
    offset += header.length + data.length;
  }

  const centralOffset = offset;
  const centralParts = centralRecords.map((record) =>
    Buffer.concat([
      uint32(0x02014b50),
      uint16(20),
      uint16(20),
      uint16(0),
      uint16(0),
      uint16(dosTime),
      uint16(dosDate),
      uint32(record.crc),
      uint32(record.data.length),
      uint32(record.data.length),
      uint16(record.path.length),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(record.localHeaderOffset),
      record.path
    ])
  );
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const endRecord = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(centralRecords.length),
    uint16(centralRecords.length),
    uint32(centralSize),
    uint32(centralOffset),
    uint16(0)
  ]);

  return Buffer.concat([...localParts, ...centralParts, endRecord]);
}

function normalizeZipPath(path: string) {
  return path.replace(/^\/+/, "").replace(/\\/g, "/");
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);

  return { dosDate, dosTime };
}

function uint16(value: number) {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function uint32(value: number) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }

  return table;
}
