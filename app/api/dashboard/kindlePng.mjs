import UPNG from 'upng-js';
import { deflate } from 'pako';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
let crcTable;

function toArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function asciiBytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }
  return bytes;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function getCrcTable() {
  if (crcTable) {
    return crcTable;
  }

  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

function crc32(type, data) {
  const table = getCrcTable();
  let crc = 0xffffffff;

  for (const byte of type) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(typeString, data = new Uint8Array()) {
  const type = asciiBytes(typeString);
  const chunk = new Uint8Array(12 + data.length);

  writeUint32(chunk, 0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(type, data));

  return chunk;
}

function concatBytes(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function encodeGrayscalePng(width, height, grayscalePixels) {
  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * (width + 1);
    const pixelOffset = y * width;
    raw[rawOffset] = 0;
    raw.set(grayscalePixels.subarray(pixelOffset, pixelOffset + width), rawOffset + 1);
  }

  const idat = deflate(raw, { level: 9 });

  return concatBytes([
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND'),
  ]);
}

export function makeOpaqueGrayscalePng(pngBytes, background = 255) {
  const source = UPNG.decode(toArrayBuffer(pngBytes));
  const rgba = new Uint8Array(UPNG.toRGBA8(source)[0]);
  const grayscale = new Uint8Array(source.width * source.height);

  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < rgba.length; sourceIndex += 4, targetIndex += 1) {
    const alpha = rgba[sourceIndex + 3] / 255;
    const red = Math.round(rgba[sourceIndex] * alpha + background * (1 - alpha));
    const green = Math.round(rgba[sourceIndex + 1] * alpha + background * (1 - alpha));
    const blue = Math.round(rgba[sourceIndex + 2] * alpha + background * (1 - alpha));

    grayscale[targetIndex] = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
  }

  return encodeGrayscalePng(source.width, source.height, grayscale);
}
