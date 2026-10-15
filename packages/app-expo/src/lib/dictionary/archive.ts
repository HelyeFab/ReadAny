/**
 * Turn whatever was picked into a flat map of file name → bytes.
 *
 * Dictionaries arrive in several wrappings. Yomitan always ships a zip;
 * StarDict is usually a .tar.gz or .tar.bz2 (that is how most sites serve it),
 * sometimes a zip, and sometimes just its three or four files side by side,
 * which the picker can hand over together. All of them end up as the same map,
 * so each importer only has to recognise its own files.
 *
 * Inner .gz members (.idx.gz, .dict.dz) are left compressed here; the importer
 * that understands them decides when to inflate, so a 100 MB dictionary is not
 * held twice for no reason.
 */
import { File } from "expo-file-system";
import { gunzipSync, strFromU8, unzipSync } from "fflate";

export type FileMap = Record<string, Uint8Array>;

export interface PickedFile {
  uri: string;
  name: string;
}

export class UnsupportedArchiveError extends Error {}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length > 3 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function isBzip2(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x42 && bytes[1] === 0x5a && bytes[2] === 0x68;
}

/** A tar header carries "ustar" at offset 257. */
function looksLikeTar(bytes: Uint8Array): boolean {
  if (bytes.length < 512) return false;
  const magic = String.fromCharCode(...bytes.subarray(257, 262));
  return magic === "ustar";
}

function readString(bytes: Uint8Array, start: number, length: number): string {
  let end = start;
  while (end < start + length && bytes[end] !== 0) end += 1;
  return strFromU8(bytes.subarray(start, end));
}

function readOctal(bytes: Uint8Array, start: number, length: number): number {
  const text = readString(bytes, start, length).trim();
  return text ? Number.parseInt(text, 8) || 0 : 0;
}

/** Minimal tar reader: regular files only, with ustar prefixes and GNU long names. */
export function untar(bytes: Uint8Array): FileMap {
  const files: FileMap = {};
  let offset = 0;
  let longName: string | null = null;

  while (offset + 512 <= bytes.length) {
    // Two zero blocks end the archive; one is enough to know we are done.
    if (bytes[offset] === 0) break;
    const name = readString(bytes, offset, 100);
    const size = readOctal(bytes, offset + 124, 12);
    const type = String.fromCharCode(bytes[offset + 156] || 0x30);
    const prefix = readString(bytes, offset + 345, 155);
    const dataStart = offset + 512;
    const data = bytes.subarray(dataStart, dataStart + size);

    if (type === "L") {
      longName = strFromU8(data).replace(/\0+$/, "");
    } else if (type === "0" || type === "\0" || type === "7") {
      const fullName = longName ?? (prefix ? `${prefix}/${name}` : name);
      files[fullName] = data;
      longName = null;
    } else {
      longName = null;
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Read every picked file and unpack the containers among them. */
export async function readPickedFiles(picked: PickedFile[]): Promise<FileMap> {
  const files: FileMap = {};

  for (const item of picked) {
    const bytes = await new File(item.uri).bytes();
    const lower = item.name.toLowerCase();

    if (isZip(bytes)) {
      Object.assign(files, unzipSync(bytes));
    } else if (isBzip2(bytes)) {
      throw new UnsupportedArchiveError(
        `${item.name} is bzip2-compressed, which this app cannot open. Unpack it on a computer and import the files inside, or re-pack them as a .zip.`,
      );
    } else if (isGzip(bytes) && (lower.endsWith(".tar.gz") || lower.endsWith(".tgz"))) {
      Object.assign(files, untar(gunzipSync(bytes)));
    } else if (looksLikeTar(bytes)) {
      Object.assign(files, untar(bytes));
    } else {
      // A loose file — .ifo, .idx(.gz), .dict(.dz), .syn — kept as it is.
      files[item.name] = bytes;
    }
  }
  return files;
}
