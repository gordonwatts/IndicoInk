import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface LaunchArtifact {
  label: string;
  path: string;
}

export const getLaunchArtifacts = (
  buildDir: string,
  rendererName: string,
): LaunchArtifact[] => [
  { label: 'main bundle', path: join(buildDir, 'main.js') },
  { label: 'preload bundle', path: join(buildDir, 'preload.js') },
  {
    label: 'renderer HTML',
    path: join(buildDir, `../renderer/${rendererName}/index.html`),
  },
];

export const assertLaunchArtifacts = (artifacts: LaunchArtifact[]) => {
  const missing = artifacts.filter((artifact) => !existsSync(artifact.path));

  if (missing.length > 0) {
    throw new Error(
      [
        'Launch artifacts are missing.',
        ...missing.map((artifact) => `- ${artifact.label}: ${artifact.path}`),
      ].join('\n'),
    );
  }
};
