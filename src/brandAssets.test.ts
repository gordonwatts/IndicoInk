import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function readPng(name: string) {
  const bytes = readFileSync(resolve('assets', 'icons', name));
  expect(bytes.subarray(0, pngSignature.length)).toEqual(pngSignature);

  const idatChunks: Buffer[] = [];
  let offset = pngSignature.length;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  let reachedEnd = false;

  while (offset < bytes.length) {
    const chunkLength = bytes.readUInt32BE(offset);
    const chunkType = bytes.toString('ascii', offset + 4, offset + 8);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;

    expect(chunkEnd + 4).toBeLessThanOrEqual(bytes.length);

    if (chunkType === 'IHDR') {
      width = bytes.readUInt32BE(chunkStart);
      height = bytes.readUInt32BE(chunkStart + 4);
      bitDepth = bytes.readUInt8(chunkStart + 8);
      colorType = bytes.readUInt8(chunkStart + 9);
      expect(bytes.readUInt8(chunkStart + 10)).toBe(0);
      expect(bytes.readUInt8(chunkStart + 11)).toBe(0);
      expect(bytes.readUInt8(chunkStart + 12)).toBe(0);
    } else if (chunkType === 'IDAT') {
      idatChunks.push(bytes.subarray(chunkStart, chunkEnd));
    } else if (chunkType === 'IEND') {
      reachedEnd = true;
      expect(chunkLength).toBe(0);
      expect(chunkEnd + 4).toBe(bytes.length);
      break;
    }

    offset = chunkEnd + 4;
  }

  expect(reachedEnd).toBe(true);
  expect(idatChunks.length).toBeGreaterThan(0);

  return {
    width,
    height,
    colorType,
    bitDepth,
    decodedBytes: inflateSync(Buffer.concat(idatChunks)),
  };
}

describe('brand icon assets', () => {
  it.each(['indicoink-light.png', 'indicoink-dark.png'])(
    'keeps %s as a complete, decodable PNG',
    (name) => {
      const image = readPng(name);

      expect(image.width).toBe(1254);
      expect(image.height).toBe(1254);
      expect(image.bitDepth).toBe(8);
      expect(image.colorType).toBe(2);
      expect(image.decodedBytes).toHaveLength(
        image.height * (1 + image.width * 3),
      );
    },
  );
});
