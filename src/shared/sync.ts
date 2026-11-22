export type SyncState =
  | 'not-configured'
  | 'idle'
  | 'checking'
  | 'publishing'
  | 'receiving'
  | 'waiting'
  | 'paused'
  | 'needs-attention';

export type SyncStatus = {
  state: SyncState;
  message: string;
  pendingChanges: number;
  folderPath: string | null;
  lastCheckedAt: number | null;
  lastPublishedAt: number | null;
  peerReceivedAt: number | null;
  cloudDeliveryConfirmed: false;
};

export const initialSyncStatus: SyncStatus = {
  state: 'not-configured',
  message: 'Set up sync across your devices.',
  pendingChanges: 0,
  folderPath: null,
  lastCheckedAt: null,
  lastPublishedAt: null,
  peerReceivedAt: null,
  cloudDeliveryConfirmed: false,
};
