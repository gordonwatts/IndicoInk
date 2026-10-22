import { test } from '@playwright/test';

import { verifyWindowStatePersistence } from './windowStatePersistenceCheck';

test('restores the main window bounds and display mode after restart', async () => {
  await verifyWindowStatePersistence();
});
