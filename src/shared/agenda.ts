export type AgendaTalkSummary = {
  id: string;
  conferenceId: string;
  contributionId: string;
  contributionUrl: string;
  sortStartsAt: number | null;
  startsAt?: number | null;
  endsAt?: number | null;
  eventTimeZone?: string;
  dayLabel: string;
  title: string;
  speaker: string;
  sessionTitle: string;
  timeRangeLabel: string;
  room: string;
  bookmarked: boolean;
  materialSummary: string;
  materials: AgendaTalkMaterialSummary[];
  annotatedSlideCount: number;
  annotatedNotePageCount?: number;
  upstreamStatus?: 'present' | 'changed' | 'missing';
  upstreamSummary?: string;
  entryKind?: 'talk' | 'linked-agenda';
  linkedAgendaUrl?: string;
};

export type AgendaTalkMaterialSummary = {
  id: string;
  title: string;
  sourceUrl: string;
  mimeType: string;
  selected: boolean;
  pageCount: number | null;
  upstreamStatus?: 'present' | 'changed' | 'missing';
};
