import type { NormalizedPagePoint } from '../inkGeometry';

export type ExportConferenceSummary = {
  id: string;
  title: string;
  dates: string;
  host: string;
  sourceUrl: string;
  exportedAt: number;
};

export type ExportSlideAnnotationStroke = {
  id: string;
  kind: 'stroke';
  points: NormalizedPagePoint[];
  color?: string;
};

export type ExportSlideAnnotationText = {
  id: string;
  kind: 'text';
  x: number;
  y: number;
  text: string;
};

export type ExportRenderedSlideLink = {
  label: string;
  url: string;
};

export type ExportSlideAnnotation =
  | ExportSlideAnnotationStroke
  | ExportSlideAnnotationText;

export type ExportSlideSnapshot = {
  id: string;
  slideNumber: number;
  filePath: string;
  annotations: ExportSlideAnnotation[];
};

export type ExportDeckSnapshot = {
  id: string;
  displayName: string;
  sourceUrl: string;
  filePath: string;
  selected: boolean;
  slides: ExportSlideSnapshot[];
};

export type ExportNotePageSnapshot = {
  id: string;
  pageNumber: number;
  referenceSlideNumber: number | null;
  annotations: ExportSlideAnnotation[];
};

export type ExportTalkSnapshot = {
  id: string;
  contributionId: string;
  contributionUrl: string;
  title: string;
  speaker: string;
  sessionTitle: string;
  startsAt: number | null;
  endsAt: number | null;
  room: string;
  bookmarked: boolean;
  decks: ExportDeckSnapshot[];
  notes?: ExportNotePageSnapshot[];
};

export type ConferenceExportSnapshot = {
  conference: ExportConferenceSummary;
  talks: ExportTalkSnapshot[];
  restoredDecks?: Array<{ talkTitle: string; deckDisplayName: string }>;
};

export type ExportRenderedSlide = {
  talkId: string;
  contributionId: string;
  contributionUrl: string;
  talkTitle: string;
  sessionTitle: string;
  deckId: string;
  deckDisplayName: string;
  deckSourceUrl: string;
  slideNumber: number;
  imageDataUrl: string;
  links: ExportRenderedSlideLink[];
};

export type ExportRenderedNotePage = {
  talkId: string;
  talkTitle: string;
  pageNumber: number;
  referenceSlideNumber: number | null;
  imageDataUrl: string;
};
