const toBytes = (value: string) => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value);
  }

  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0;
    if (codePoint > 0xffff) {
      index += 1;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
      continue;
    }

    if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6));
      bytes.push(0x80 | (codePoint & 0x3f));
      continue;
    }

    if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12));
      bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
      bytes.push(0x80 | (codePoint & 0x3f));
      continue;
    }

    bytes.push(0xf0 | (codePoint >> 18));
    bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
    bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
    bytes.push(0x80 | (codePoint & 0x3f));
  }

  return new Uint8Array(bytes);
};

const leftRotate = (value: number, shift: number) =>
  ((value << shift) | (value >>> (32 - shift))) >>> 0;

export const sha1Hex = (value: string) => {
  const bytes = toBytes(value);
  const bitLength = bytes.length * 8;
  const paddingLength = (56 - ((bytes.length + 1) % 64) + 64) % 64;
  const message = new Uint8Array(bytes.length + 1 + paddingLength + 8);

  message.set(bytes, 0);
  message[bytes.length] = 0x80;

  const lengthOffset = message.length - 8;
  const lengthHigh = Math.floor(bitLength / 0x100000000);
  const lengthLow = bitLength >>> 0;
  message[lengthOffset] = (lengthHigh >>> 24) & 0xff;
  message[lengthOffset + 1] = (lengthHigh >>> 16) & 0xff;
  message[lengthOffset + 2] = (lengthHigh >>> 8) & 0xff;
  message[lengthOffset + 3] = lengthHigh & 0xff;
  message[lengthOffset + 4] = (lengthLow >>> 24) & 0xff;
  message[lengthOffset + 5] = (lengthLow >>> 16) & 0xff;
  message[lengthOffset + 6] = (lengthLow >>> 8) & 0xff;
  message[lengthOffset + 7] = lengthLow & 0xff;

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const words = new Uint32Array(80);

  for (let offset = 0; offset < message.length; offset += 64) {
    for (let wordIndex = 0; wordIndex < 16; wordIndex += 1) {
      const byteIndex = offset + wordIndex * 4;
      words[wordIndex] =
        ((message[byteIndex] ?? 0) << 24) |
        ((message[byteIndex + 1] ?? 0) << 16) |
        ((message[byteIndex + 2] ?? 0) << 8) |
        (message[byteIndex + 3] ?? 0);
    }

    for (let wordIndex = 16; wordIndex < 80; wordIndex += 1) {
      const wordA = words[wordIndex - 3] ?? 0;
      const wordB = words[wordIndex - 8] ?? 0;
      const wordC = words[wordIndex - 14] ?? 0;
      const wordD = words[wordIndex - 16] ?? 0;
      words[wordIndex] = leftRotate(wordA ^ wordB ^ wordC ^ wordD, 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let wordIndex = 0; wordIndex < 80; wordIndex += 1) {
      let f = 0;
      let k = 0;

      if (wordIndex < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (wordIndex < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (wordIndex < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const currentWord = words[wordIndex] ?? 0;
      const temp =
        (leftRotate(a, 5) + (f >>> 0) + (e >>> 0) + k + currentWord) >>> 0;
      e = d;
      d = c;
      c = leftRotate(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const toHex = (value: number) => value.toString(16).padStart(8, '0');
  return `${toHex(h0)}${toHex(h1)}${toHex(h2)}${toHex(h3)}${toHex(h4)}`;
};
