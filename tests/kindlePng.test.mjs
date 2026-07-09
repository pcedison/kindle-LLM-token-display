import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import test from 'node:test';

import { makeOpaqueGrayscalePng } from '../app/api/dashboard/kindlePng.mjs';

const RGBA_TWO_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVR4nGP4zwAG/wEJAAH/lWP4QwAAAABJRU5ErkJggg==',
  'base64',
);

function parsePng(bytes) {
  const data = Buffer.from(bytes);
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const chunks = [];
  let offset = 8;
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString('ascii');
    const chunkData = data.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data: chunkData });
    offset += 12 + length;
    if (type === 'IEND') break;
  }

  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR')?.data;
  assert.ok(ihdr, 'PNG should include IHDR');

  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr[8],
    colorType: ihdr[9],
    imageData: Buffer.concat(
      chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data),
    ),
  };
}

test('converts RGBA dashboard PNGs into opaque 8-bit grayscale PNGs for Kindle eips', () => {
  const source = parsePng(RGBA_TWO_PIXEL_PNG);
  assert.equal(source.colorType, 6);

  const output = makeOpaqueGrayscalePng(RGBA_TWO_PIXEL_PNG);
  const png = parsePng(output);

  assert.equal(png.width, 2);
  assert.equal(png.height, 1);
  assert.equal(png.bitDepth, 8);
  assert.equal(png.colorType, 0);

  const scanline = inflateSync(png.imageData);
  assert.deepEqual([...scanline], [0, 255, 0]);
});
