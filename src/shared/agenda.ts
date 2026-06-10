export type AgendaTalkSummary = {
  id: string;
  conferenceId: string;
  contributionId: string;
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
};

export type AgendaTalkMaterialSummary = {
  id: string;
  title: string;
  sourceUrl: string;
  mimeType: string;
  selected: boolean;
  pageCount: number | null;
};
