export const POWERPOINT_MIME_TYPES = new Set([
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
  'application/vnd.ms-powerpoint.template.macroenabled.12',
]);

const normalizedMimeType = (mimeType: string) =>
  mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';

const hasPowerPointExtension = (value: string) =>
  /\.(?:pptx?|ppsx?|potx?)($|[?#])/i.test(value);

const hasLegacyPowerPointExtension = (value: string) =>
  /\.ppt($|[?#])/i.test(value);

const hasPdfExtension = (value: string) => /\.pdf($|[?#])/i.test(value);

const googleSlidesPathPattern = /^\/presentation\/d\/([^/?#]+)/i;

/** Return true for a public Google Slides presentation URL. */
export const isGoogleSlidesDeck = (sourceUrl: string) => {
  try {
    const url = new URL(sourceUrl);
    return (
      url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'docs.google.com' &&
      googleSlidesPathPattern.test(url.pathname)
    );
  } catch {
    return false;
  }
};

/** Convert a Google Slides editor/share URL to its PDF export endpoint. */
export const getGoogleSlidesPdfUrl = (sourceUrl: string) => {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return sourceUrl;
  }

  const match = url.pathname.match(googleSlidesPathPattern);
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'docs.google.com' ||
    !match?.[1]
  ) {
    return sourceUrl;
  }

  url.pathname = `/presentation/d/${match[1]}/export/pdf`;
  url.search = '';
  url.hash = '';
  return url.toString();
};

export const getSlideDeckDownloadUrl = (sourceUrl = '') =>
  isGoogleSlidesDeck(sourceUrl) ? getGoogleSlidesPdfUrl(sourceUrl) : sourceUrl;

export const isPowerPointDeck = (
  mimeType: string,
  sourceUrl = '',
  displayName = '',
) => {
  const normalizedMime = normalizedMimeType(mimeType);
  if (POWERPOINT_MIME_TYPES.has(normalizedMime)) {
    return true;
  }

  return (
    hasPowerPointExtension(sourceUrl) || hasPowerPointExtension(displayName)
  );
};

export const isPdfDeck = (mimeType: string, sourceUrl = '', displayName = '') =>
  normalizedMimeType(mimeType).includes('pdf') ||
  hasPdfExtension(sourceUrl) ||
  hasPdfExtension(displayName) ||
  isGoogleSlidesDeck(sourceUrl);

export const isSlideDeck = (
  mimeType: string,
  sourceUrl = '',
  displayName = '',
) =>
  isPdfDeck(mimeType, sourceUrl, displayName) ||
  isPowerPointDeck(mimeType, sourceUrl, displayName);

type SlideDeckCandidate = {
  mimeType: string;
  selected?: boolean;
  sourceUrl?: string;
  url?: string;
  title?: string;
  displayName?: string;
};

/** Prefer a PDF when an imported talk offers both PDF and PowerPoint decks. */
export const choosePreferredSlideDeck = <T extends SlideDeckCandidate>(
  materials: readonly T[],
) => {
  const slideDecks = materials.filter((material) =>
    isSlideDeck(
      material.mimeType,
      material.sourceUrl ?? material.url ?? '',
      material.title ?? material.displayName ?? '',
    ),
  );
  return (
    slideDecks.find(
      (material) =>
        material.selected &&
        isPdfDeck(
          material.mimeType,
          material.sourceUrl ?? material.url ?? '',
          material.title ?? material.displayName ?? '',
        ),
    ) ??
    slideDecks.find((material) =>
      isPdfDeck(
        material.mimeType,
        material.sourceUrl ?? material.url ?? '',
        material.title ?? material.displayName ?? '',
      ),
    ) ??
    slideDecks.find((material) => material.selected) ??
    slideDecks[0] ??
    null
  );
};

export const getPowerPointExtension = (
  mimeType: string,
  sourceUrl = '',
  displayName = '',
) =>
  hasLegacyPowerPointExtension(sourceUrl) ||
  hasLegacyPowerPointExtension(displayName) ||
  normalizedMimeType(mimeType) === 'application/vnd.ms-powerpoint'
    ? '.ppt'
    : '.pptx';
