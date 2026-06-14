import { getStrokeWidth } from './strokeTools';
import type {
  ConferenceExportSnapshot,
  ExportRenderedSlide,
  ExportSlideAnnotation,
  ExportTalkSnapshot,
} from './shared/exportNotes';

export type ExportRenderJob = {
  talkId: string;
  contributionId: string;
  contributionUrl: string;
  talkTitle: string;
  sessionTitle: string;
  deckId: string;
  deckDisplayName: string;
  deckSourceUrl: string;
  deckFilePath: string;
  slideNumber: number;
  annotations: ExportSlideAnnotation[];
};

type PdfDocumentLike = {
  getPage: (pageNumber: number) => Promise<PdfPageLike>;
};

type PdfDocumentHandle = {
  document: PdfDocumentLike;
  destroy: () => Promise<void> | void;
};

type PdfPageLike = {
  getViewport: (options: { scale: number }) => {
    width: number;
    height: number;
  };
  render: (options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
};

type LoadPdfDocument = (bytes: Uint8Array) => Promise<PdfDocumentHandle>;

export const collectExportRenderJobs = (
  snapshot: ConferenceExportSnapshot,
): ExportRenderJob[] =>
  snapshot.talks.flatMap((talk) =>
    talk.decks.flatMap((deck) =>
      deck.slides.map((slide) => ({
        talkId: talk.id,
        contributionId: talk.contributionId,
        contributionUrl: talk.contributionUrl,
        talkTitle: talk.title,
        sessionTitle: talk.sessionTitle,
        deckId: deck.id,
        deckDisplayName: deck.displayName,
        deckSourceUrl: deck.sourceUrl,
        deckFilePath: deck.filePath,
        slideNumber: slide.slideNumber,
        annotations: slide.annotations,
      })),
    ),
  );

const formatDateTimeParts = (value: number) =>
  new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(new Date(value));

const getDateTimePart = (parts: Intl.DateTimeFormatPart[], type: string) =>
  parts.find((part) => part.type === type)?.value ?? '';

const formatLocalDateTime = (value: number) => {
  const parts = formatDateTimeParts(value);
  const year = getDateTimePart(parts, 'year');
  const month = getDateTimePart(parts, 'month');
  const day = getDateTimePart(parts, 'day');
  const hour = getDateTimePart(parts, 'hour').replace(/^0/, '');
  const minute = getDateTimePart(parts, 'minute');
  const dayPeriod = getDateTimePart(parts, 'dayPeriod');
  const timeZoneName = getDateTimePart(parts, 'timeZoneName');

  return `${year}-${month}-${day} ${hour}:${minute}${dayPeriod ? ` ${dayPeriod}` : ''}${timeZoneName ? ` ${timeZoneName}` : ''}`.trim();
};

const formatTalkStartTime = (value: number) => {
  const parts = formatDateTimeParts(value);
  const year = getDateTimePart(parts, 'year');
  const month = getDateTimePart(parts, 'month');
  const day = getDateTimePart(parts, 'day');
  const hour = getDateTimePart(parts, 'hour').replace(/^0/, '');
  const minute = getDateTimePart(parts, 'minute');
  const dayPeriod = getDateTimePart(parts, 'dayPeriod');
  const timeZoneName = getDateTimePart(parts, 'timeZoneName');

  return `${year}-${month}-${day} ${hour}:${minute}${dayPeriod ? ` ${dayPeriod}` : ''}${timeZoneName ? ` ${timeZoneName}` : ''}`.trim();
};

const escapeMarkdown = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll('|', '\\|');

const escapeHtmlAttribute = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const renderStroke = (
  context: CanvasRenderingContext2D,
  pageWidth: number,
  pageHeight: number,
  stroke: Extract<ExportSlideAnnotation, { kind: 'stroke' }>,
) => {
  if (stroke.points.length < 2) {
    return;
  }

  context.save();
  context.beginPath();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#000000';
  context.moveTo(
    stroke.points[0]!.x * pageWidth,
    stroke.points[0]!.y * pageHeight,
  );

  for (let index = 1; index < stroke.points.length; index += 1) {
    const point = stroke.points[index]!;
    context.lineTo(point.x * pageWidth, point.y * pageHeight);
  }

  const averagePressure =
    stroke.points.reduce((total, point) => total + point.pressure, 0) /
    stroke.points.length;
  context.lineWidth = getStrokeWidth(averagePressure) * 2;
  context.stroke();
  context.restore();
};

const renderTextNote = (
  context: CanvasRenderingContext2D,
  pageWidth: number,
  pageHeight: number,
  note: Extract<ExportSlideAnnotation, { kind: 'text' }>,
) => {
  const x = note.x * pageWidth;
  const y = note.y * pageHeight;
  const paddingX = 14;
  const paddingY = 10;
  const fontSize = Math.max(18, Math.round(pageWidth * 0.022));
  const font = `${fontSize}px Arial, sans-serif`;

  context.save();
  context.font = font;
  context.textBaseline = 'top';
  const lines = note.text.split(/\r?\n/);
  const lineHeight = Math.round(fontSize * 1.35);
  const textWidth = Math.max(
    ...lines.map((line) => context.measureText(line).width),
    0,
  );
  const boxWidth = Math.ceil(textWidth + paddingX * 2);
  const boxHeight = Math.ceil(lines.length * lineHeight + paddingY * 2);
  const boxX = Math.max(0, Math.min(pageWidth - boxWidth, x));
  const boxY = Math.max(0, Math.min(pageHeight - boxHeight, y));

  context.fillStyle = 'rgba(255, 255, 255, 0.94)';
  context.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  context.lineWidth = 2;
  context.fillRect(boxX, boxY, boxWidth, boxHeight);
  context.strokeRect(boxX, boxY, boxWidth, boxHeight);
  context.fillStyle = '#111111';

  lines.forEach((line, index) => {
    context.fillText(
      line,
      boxX + paddingX,
      boxY + paddingY + index * lineHeight,
    );
  });

  context.restore();
};

export const renderAnnotatedSlidePng = async ({
  filePath,
  slideNumber,
  annotations,
  readPdfBytes,
  loadPdfDocument,
  createCanvas,
  exportScale = 2,
}: {
  filePath: string;
  slideNumber: number;
  annotations: ExportSlideAnnotation[];
  readPdfBytes: (filePath: string) => Promise<Uint8Array>;
  loadPdfDocument?: LoadPdfDocument;
  createCanvas?: () => HTMLCanvasElement;
  exportScale?: number;
}): Promise<string> => {
  const bytes = await readPdfBytes(filePath);
  const loadDocument =
    loadPdfDocument ??
    (async (input: Uint8Array) => {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = getDocument({
        data: input,
        intent: 'print',
      } as never);
      return {
        document: (await task.promise) as unknown as PdfDocumentLike,
        destroy: () => task.destroy(),
      };
    });

  const { document, destroy } = await loadDocument(bytes);
  try {
    const page = await document.getPage(slideNumber);
    const viewport = page.getViewport({ scale: exportScale });
    const canvas =
      createCanvas?.() ?? globalThis.document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas rendering is unavailable for export.');
    }

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    context.setTransform(1, 0, 0, 1, 0, 0);

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise;

    for (const annotation of annotations) {
      if (annotation.kind === 'stroke') {
        renderStroke(context, viewport.width, viewport.height, annotation);
      } else {
        renderTextNote(context, viewport.width, viewport.height, annotation);
      }
    }

    return canvas.toDataURL('image/png');
  } finally {
    await destroy?.();
  }
};

const formatTalkDateRange = (talk: ExportTalkSnapshot) => {
  if (talk.startsAt != null && talk.endsAt != null) {
    const durationMinutes = Math.max(
      1,
      Math.round((talk.endsAt - talk.startsAt) / 60_000),
    );
    return `${formatTalkStartTime(talk.startsAt)} (${durationMinutes} minute${durationMinutes === 1 ? '' : 's'})`;
  }

  if (talk.startsAt != null) {
    return formatTalkStartTime(talk.startsAt);
  }

  if (talk.endsAt != null) {
    return formatTalkStartTime(talk.endsAt);
  }

  return 'Time unavailable';
};

export const buildConferenceNotesMarkdown = (
  snapshot: ConferenceExportSnapshot,
  renderedSlides: ExportRenderedSlide[],
) => {
  const renderedBySlide = new Map(
    renderedSlides.map(
      (slide) =>
        [
          `${slide.talkId}:${slide.deckId}:${slide.slideNumber}`,
          slide,
        ] as const,
    ),
  );

  const lines: string[] = [];
  lines.push(`# ${snapshot.conference.title}`);
  lines.push('');
  lines.push(`- [Conference URL](${snapshot.conference.sourceUrl})`);
  lines.push(`- Conference dates: ${snapshot.conference.dates}`);
  lines.push(
    `- Exported at: ${formatLocalDateTime(snapshot.conference.exportedAt)}`,
  );
  lines.push('');

  for (const talk of snapshot.talks) {
    lines.push(`## ${escapeMarkdown(talk.title)}`);
    lines.push('');
    lines.push(`- Speaker: ${escapeMarkdown(talk.speaker || 'Not available')}`);
    if (talk.sessionTitle && talk.sessionTitle !== 'Unscheduled') {
      lines.push(`- Session: ${escapeMarkdown(talk.sessionTitle)}`);
    }
    lines.push(`- Time: ${escapeMarkdown(formatTalkDateRange(talk))}`);

    const firstRenderedDeck = renderedSlides.find(
      (slide) => slide.talkId === talk.id,
    );
    if (firstRenderedDeck) {
      lines.push(`- [Original Slides](${firstRenderedDeck.deckSourceUrl})`);
      lines.push('');
    }

    for (const deck of talk.decks) {
      for (const slide of deck.slides) {
        const rendered = renderedBySlide.get(
          `${talk.id}:${deck.id}:${slide.slideNumber}`,
        );
        if (!rendered) {
          continue;
        }

        lines.push(`### Slide ${slide.slideNumber}`);
        lines.push('');
        lines.push(
          `<img alt="${escapeHtmlAttribute(
            `Slide ${slide.slideNumber}`,
          )}" src="${escapeHtmlAttribute(rendered.imageDataUrl)}" />`,
        );
        lines.push('');
      }
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
};
