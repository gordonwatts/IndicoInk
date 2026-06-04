import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assertLaunchArtifacts, getLaunchArtifacts } from './launchDiagnostics';

describe('launch diagnostics', () => {
  it('throws a clear error when a required artifact is missing', () => {
    const buildDir = mkdtempSync(join(tmpdir(), 'indicoink-launch-'));

    const preloadPath = join(buildDir, 'preload.js');
    writeFileSync(preloadPath, '// preload');

    expect(() =>
      assertLaunchArtifacts(getLaunchArtifacts(buildDir, 'main_window')),
    ).toThrowError(/main bundle/);
  });

  it('accepts a complete set of launch artifacts', () => {
    const buildDir = mkdtempSync(join(tmpdir(), 'indicoink-launch-'));

    writeFileSync(join(buildDir, 'main.js'), '// main');
    writeFileSync(join(buildDir, 'preload.js'), '// preload');

    const rendererDir = join(buildDir, '..', 'renderer', 'main_window');
    mkdirSync(rendererDir, { recursive: true });
    writeFileSync(join(rendererDir, 'index.html'), '<!doctype html>');

    expect(() =>
      assertLaunchArtifacts(getLaunchArtifacts(buildDir, 'main_window')),
    ).not.toThrow();
  });
});
