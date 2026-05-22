/**
 * Append-only source editor with line-level v3 source-map generation.
 *
 * A deliberately tiny replacement for `magic-string` covering only the
 * operations the transformer needs: `appendLeft` and `appendRight`.
 *
 * Source-map strategy: one segment at column 0 of every output line, mapping
 * back to the source position where reading resumes. Inserted-only lines get
 * no segment; debuggers fall through to the previous mapping, which points at
 * the originating `console.X(...)` call — the correct behaviour for our
 * transform.
 */

export interface SourceMapV3 {
  version: 3;
  file?: string;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

interface EditBucket {
  left: string[];
  right: string[];
}

export class SourceEdits {
  private readonly code: string;
  private readonly filename: string;
  private readonly edits = new Map<number, EditBucket>();

  constructor(code: string, filename: string) {
    this.code = code;
    this.filename = filename;
  }

  private bucket(pos: number): EditBucket {
    let b = this.edits.get(pos);
    if (!b) {
      b = { left: [], right: [] };
      this.edits.set(pos, b);
    }
    return b;
  }

  appendLeft(pos: number, str: string): this {
    this.bucket(pos).left.push(str);
    return this;
  }

  appendRight(pos: number, str: string): this {
    this.bucket(pos).right.push(str);
    return this;
  }

  hasEdits(): boolean {
    return this.edits.size > 0;
  }

  toString(): string {
    const positions = [...this.edits.keys()].sort((a, b) => a - b);
    let out = "";
    let cursor = 0;
    for (const pos of positions) {
      out += this.code.slice(cursor, pos);
      const e = this.edits.get(pos)!;
      out += e.left.join("");
      out += e.right.join("");
      cursor = pos;
    }
    out += this.code.slice(cursor);
    return out;
  }

  generateMap(): SourceMapV3 {
    const code = this.code;
    const positions = [...this.edits.keys()].sort((a, b) => a - b);

    type Seg = { outCol: number; sourceLine: number; sourceCol: number };
    let sourceLine = 0;
    let sourceCol = 0;
    let outCol = 0;
    let currentSegment: Seg | null = null;
    const lineSegments: (Seg | null)[] = [];

    const flushLine = (): void => {
      lineSegments.push(currentSegment);
      currentSegment = null;
    };

    const writeSource = (ch: string): void => {
      if (currentSegment === null) {
        currentSegment = { outCol, sourceLine, sourceCol };
      }
      if (ch === "\n") {
        flushLine();
        outCol = 0;
        sourceLine++;
        sourceCol = 0;
      } else {
        outCol++;
        sourceCol++;
      }
    };

    const writeInserted = (ch: string): void => {
      if (ch === "\n") {
        flushLine();
        outCol = 0;
      } else {
        outCol++;
      }
    };

    let cursor = 0;
    for (const pos of positions) {
      for (let i = cursor; i < pos; i++) {
        writeSource(code.charAt(i));
      }
      const e = this.edits.get(pos)!;
      const inserted = e.left.join("") + e.right.join("");
      for (let i = 0; i < inserted.length; i++) {
        writeInserted(inserted.charAt(i));
      }
      cursor = pos;
    }
    for (let i = cursor; i < code.length; i++) {
      writeSource(code.charAt(i));
    }
    flushLine();

    let prevSourceLine = 0;
    let prevSourceCol = 0;
    const mappingLines = lineSegments.map((seg) => {
      if (seg === null) return "";
      const s =
        vlq(seg.outCol) +
        vlq(0) +
        vlq(seg.sourceLine - prevSourceLine) +
        vlq(seg.sourceCol - prevSourceCol);
      prevSourceLine = seg.sourceLine;
      prevSourceCol = seg.sourceCol;
      return s;
    });

    return {
      version: 3,
      file: this.filename,
      sources: [this.filename],
      sourcesContent: [code],
      names: [],
      mappings: mappingLines.join(";"),
    };
  }
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlq(n: number): string {
  let v = n < 0 ? ((-n) << 1) | 1 : n << 1;
  let out = "";
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += BASE64.charAt(digit);
  } while (v > 0);
  return out;
}
