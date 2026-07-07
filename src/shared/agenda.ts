export type AgendaTalkSummary = {
  id: string;
  conferenceId: string;
  contributionId: string;
  contributionUrl: string;
  sortStartsAt: number | null;
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
  upstreamStatus?: 'present' | 'changed' | 'missing';
  upstreamSummary?: string;
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
