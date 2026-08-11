import type { Conference, Talk } from './persistenceModels';

export type AgendaHierarchySession = {
  title: string;
  room: string;
  startAt: number | null;
  endAt: number | null;
  contributionIds: string[];
};

export type AgendaHierarchyDay = {
  key: string;
  label: string;
  sessions: AgendaHierarchySession[];
};

export type AgendaSpeakerEntity = {
  contributionId: string;
  name: string;
  affiliation: string;
};

export type AgendaMaterialEntity = {
  id: string;
  contributionId: string;
  title: string;
  url: string;
  mimeType: string;
  selected: boolean;
  kind: 'pdf' | 'other';
};

export type AgendaTalkEntity = Omit<
  Talk,
  'id' | 'conferenceId' | 'createdAt' | 'updatedAt'
> & {
  contributionUrl: string;
  speakers: AgendaSpeakerEntity[];
  materials: AgendaMaterialEntity[];
};

export type AgendaImportData = {
  conference: Conference;
  hierarchy: AgendaHierarchyDay[];
  talks: AgendaTalkEntity[];
  speakers: AgendaSpeakerEntity[];
  materials: AgendaMaterialEntity[];
};
