// Server-only: a small ustar reader for what pullTree brings out of a machine.
// Regular files and directories, GNU `L` long-name entries; everything else
// (symlinks, pax headers) is skipped after its data. Forty lines beat a tar
// dependency for this.

const BLOCK = 512;

function field(buf: Buffer, offset: number, length: number): string {
  const raw = buf.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
}

function octal(buf: Buffer, offset: number, length: number): number {
  const text = field(buf, offset, length).trim();
  return text ? parseInt(text, 8) : 0;
}

// Paths are as the archive names them (relative to its root). Directories
// are omitted from the map.
export function parseTar(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let pos = 0;
  let longName: string | null = null;
  while (pos + BLOCK <= buf.length) {
    const header = buf.subarray(pos, pos + BLOCK);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156]);
    const ustar = field(header, 257, 6) === 'ustar';
    const prefix = ustar ? field(header, 345, 155) : '';
    let name = longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    longName = null;
    const dataStart = pos + BLOCK;
    const data = buf.subarray(dataStart, dataStart + size);
    pos = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    if (typeflag === 'L') {
      longName = field(data, 0, data.length);
      continue;
    }
    if (typeflag === '0' || typeflag === '\0') {
      name = name.replace(/^\.\//, '');
      files.set(name, Buffer.from(data));
    }
    // '5' is a directory, anything else is skipped.
  }
  return files;
}
