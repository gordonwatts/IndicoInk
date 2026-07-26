import type { ConferenceExportSnapshot } from './shared/exportNotes';

const monthNumbers: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const sanitizeFileName = (value: string) =>
  Array.from(value.trim())
    .map((character) =>
      character.codePointAt(0) !== undefined && character.codePointAt(0)! < 32
        ? ' '
        : character,
    )
    .join('')
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const formatStartDate = (dates: string) => {
  const match = dates.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!match) {
    return null;
  }

  const [, monthName, dayText, yearText] = match;
  const month = monthName ? monthNumbers[monthName.toLowerCase()] : undefined;
  const day = Number(dayText);
  const year = Number(yearText);
  if (
    month === undefined ||
    !Number.isInteger(day) ||
    !Number.isInteger(year) ||
    day < 1 ||
    day > 31 ||
    year < 1
  ) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
};

export const createExportFileName = (
  conference: Pick<ConferenceExportSnapshot['conference'], 'title' | 'dates'>,
) => {
  const datePrefix = formatStartDate(conference.dates);
  const baseName = sanitizeFileName(conference.title) || 'indico-notes';
  return `${datePrefix ? `${datePrefix} - ` : ''}${baseName} notes.md`;
};
