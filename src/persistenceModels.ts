import type { NormalizedPagePoint } from './inkGeometry';
import { sha1Hex } from './stableHash';

const createStableId = (kind: string, identity: string) =>
  `${kind}_${sha1Hex(identity).slice(0, 20)}`;

export const createConferenceId = (sourceUrl: string) =>
  createStableId('conference', sourceUrl);

export const createTalkId = (conferenceId: string, contributionId: string) =>
  createStableId('talk', `${conferenceId}:${contributionId}`);

export const createDeckId = (talkId: string, sourceUrl: string) =>
  createStableId('deck', `${talkId}:${sourceUrl}`);

export const createSlideId = (deckId: string, slideNumber: number) =>
  createStableId('slide', `${deckId}:${slideNumber}`);

export const createAnnotationId = (slideId: string, index: number) =>
  createStableId('annotation', `${slideId}:${index}`);

export const createViewStateId = (deckId: string) =>
  createStableId('view-state', deckId);

export type Conference = {
  id: string;
  sourceUrl: string;
  title: string;
  dates: string;
  host: string;
  lastOpenedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type Talk = {
  id: string;
  conferenceId: string;
  contributionId: string;
  contributionUrl: string;
  title: string;
  speaker: string;
  sessionTitle: string;
  startsAt: number | null;
  endsAt: number | null;
  room: string;
  bookmarked: boolean;
  createdAt: number;
  updatedAt: number;
  upstreamStatus?: 'present' | 'changed' | 'missing';
};

export type Deck = {
  id: string;
  conferenceId: string;
  talkId: string;
  sourceUrl: string;
  displayName: string;
  mimeType: string;
  selected: boolean;
  createdAt: number;
  updatedAt: number;
  upstreamStatus?: 'present' | 'changed' | 'missing';
};

export type Slide = {
  id: string;
  conferenceId: string;
  talkId: string;
  deckId: string;
  slideNumber: number;
  annotated: boolean;
  createdAt: number;
  updatedAt: number;
};

export type PenStroke = {
  id: string;
  conferenceId: string;
  talkId: string;
  deckId: string;
  slideId: string;
  baseWidth?: number;
  points: NormalizedPagePoint[];
  createdAt: number;
  updatedAt: number;
};

export type TextNote = {
  id: string;
  conferenceId: string;
  talkId: string;
  deckId: string;
  slideId: string;
  x: number;
  y: number;
  width?: number | undefined;
  text: string;
  createdAt: number;
  updatedAt: number;
};

export type ViewState = {
  id: string;
  conferenceId: string;
  talkId: string;
  deckId: string;
  slideId: string | null;
  currentSlideNumber: number;
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
  createdAt: number;
  updatedAt: number;
};

export type Annotation = PenStroke | TextNote;

export type DocumentPageState = {
  slideNumber: number;
  strokes: PenStroke[];
  textNotes: TextNote[];
};

export type DocumentSnapshot = {
  sourceUrl: string;
  conference: Conference;
  talk: Talk;
  deck: Deck;
  slides: Slide[];
  annotations: Annotation[];
  viewState: ViewState | null;
};

export const countAnnotatedSlides = (slides: ReadonlyArray<Slide>) =>
  slides.filter((slide) => slide.annotated).length;

export const countAnnotations = (annotations: ReadonlyArray<Annotation>) =>
  annotations.length;
