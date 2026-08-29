export type PixelPage = {
  width: number;
  height: number;
  data: ArrayLike<number>;
};

type Rgb = readonly [number, number, number];

const MAX_SAMPLED_PIXELS = 120_000;
const CHANNEL_QUANTIZATION = 16;
const PAGE_DIFFERENCE_THRESHOLD = 36;
const INK_DIFFERENCE_THRESHOLD = 24;
const MIN_ADDITION_SHARE = 0.85;

const colorDistance = (left: Rgb, right: Rgb) =>
  Math.abs(left[0] - right[0]) +
  Math.abs(left[1] - right[1]) +
  Math.abs(left[2] - right[2]);

const readPixel = (page: PixelPage, pixelIndex: number): Rgb => {
  const offset = pixelIndex * 4;
  const alpha = (page.data[offset + 3] ?? 255) / 255;
  const compositeOverWhite = (channel: number) =>
    Math.round(channel * alpha + 255 * (1 - alpha));
  return [
    compositeOverWhite(page.data[offset] ?? 0),
    compositeOverWhite(page.data[offset + 1] ?? 0),
    compositeOverWhite(page.data[offset + 2] ?? 0),
  ];
};

const quantizedColorKey = (color: Rgb) =>
  `${Math.floor(color[0] / CHANNEL_QUANTIZATION)},${Math.floor(color[1] / CHANNEL_QUANTIZATION)},${Math.floor(color[2] / CHANNEL_QUANTIZATION)}`;

const colorFromQuantizedKey = (key: string): Rgb => {
  const [red, green, blue] = key.split(',').map(Number);
  const center = CHANNEL_QUANTIZATION / 2;
  return [
    (red ?? 15) * CHANNEL_QUANTIZATION + center,
    (green ?? 15) * CHANNEL_QUANTIZATION + center,
    (blue ?? 15) * CHANNEL_QUANTIZATION + center,
  ];
};

const getSamplingStride = (page: PixelPage) =>
  Math.max(
    1,
    Math.ceil(Math.sqrt((page.width * page.height) / MAX_SAMPLED_PIXELS)),
  );

const findDominantEdgeColor = (page: PixelPage, stride: number): Rgb => {
  const counts = new Map<string, number>();
  const addPixel = (x: number, y: number) => {
    const key = quantizedColorKey(readPixel(page, y * page.width + x));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  for (let x = 0; x < page.width; x += stride) {
    addPixel(x, 0);
    if (page.height > 1) {
      addPixel(x, page.height - 1);
    }
  }
  for (let y = stride; y < page.height - 1; y += stride) {
    addPixel(0, y);
    if (page.width > 1) {
      addPixel(page.width - 1, y);
    }
  }

  let dominantKey = '15,15,15';
  let dominantCount = -1;
  counts.forEach((count, key) => {
    if (count > dominantCount) {
      dominantKey = key;
      dominantCount = count;
    }
  });
  return colorFromQuantizedKey(dominantKey);
};

/**
 * Return true only when the second raster appears to add content to the first.
 * The test is deliberately conservative: removals, replacements, background
 * changes, and differently sized pages remain visible.
 */
export const isIncrementalSlideBuild = (
  previousPage: PixelPage,
  nextPage: PixelPage,
) => {
  if (
    previousPage.width !== nextPage.width ||
    previousPage.height !== nextPage.height ||
    previousPage.width < 1 ||
    previousPage.height < 1
  ) {
    return false;
  }

  const stride = getSamplingStride(previousPage);
  const previousBackground = findDominantEdgeColor(previousPage, stride);
  const nextBackground = findDominantEdgeColor(nextPage, stride);
  if (
    colorDistance(previousBackground, nextBackground) >
    PAGE_DIFFERENCE_THRESHOLD
  ) {
    return false;
  }

  let additions = 0;
  let removals = 0;
  let ambiguousChanges = 0;
  let sampledPixels = 0;

  for (let y = 0; y < previousPage.height; y += stride) {
    for (let x = 0; x < previousPage.width; x += stride) {
      sampledPixels += 1;
      const pixelIndex = y * previousPage.width + x;
      const previousColor = readPixel(previousPage, pixelIndex);
      const nextColor = readPixel(nextPage, pixelIndex);
      if (
        colorDistance(previousColor, nextColor) <= PAGE_DIFFERENCE_THRESHOLD
      ) {
        continue;
      }

      const previousInk = colorDistance(previousColor, previousBackground);
      const nextInk = colorDistance(nextColor, nextBackground);
      if (nextInk - previousInk >= INK_DIFFERENCE_THRESHOLD) {
        additions += 1;
      } else if (previousInk - nextInk >= INK_DIFFERENCE_THRESHOLD) {
        removals += 1;
      } else {
        ambiguousChanges += 1;
      }
    }
  }

  const changedPixels = additions + removals + ambiguousChanges;
  const minimumChangedPixels = Math.max(4, Math.ceil(sampledPixels * 0.00005));
  return (
    additions >= minimumChangedPixels &&
    additions / changedPixels >= MIN_ADDITION_SHARE
  );
};

export const findIncrementalBuildPageNumbers = (pages: PixelPage[]) => {
  const hiddenPageNumbers: number[] = [];
  for (let index = 0; index < pages.length - 1; index += 1) {
    const previousPage = pages[index];
    const nextPage = pages[index + 1];
    if (
      previousPage &&
      nextPage &&
      isIncrementalSlideBuild(previousPage, nextPage)
    ) {
      hiddenPageNumbers.push(index + 1);
    }
  }
  return hiddenPageNumbers;
};
