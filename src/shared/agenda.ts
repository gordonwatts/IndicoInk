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
  annotatedSlideCount: number;
};
