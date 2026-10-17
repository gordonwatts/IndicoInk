import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const { msixVersionFromTag } = require('./scripts/msix-version.cjs') as {
  msixVersionFromTag: (tag: string) => string;
};

describe('MSIX release versions', () => {
  it.each([
    ['v1.2.3', '1.2.3.0'],
    ['1.2.3', '1.2.3.0'],
    ['v0.0.0', '0.0.0.0'],
    ['v65535.65535.65535', '65535.65535.65535.0'],
  ])('maps %s to %s', (tag, expected) => {
    expect(msixVersionFromTag(tag)).toBe(expected);
  });

  it('maps increasing supported tags to strictly increasing MSIX versions', () => {
    const versions = ['v1.2.8', 'v1.2.9', 'v1.3.0', 'v2.0.0'].map(
      msixVersionFromTag,
    );

    expect(versions).toEqual(['1.2.8.0', '1.2.9.0', '1.3.0.0', '2.0.0.0']);
    expect(
      versions
        .map((version) => version.split('.').map(Number))
        .every((version, index, all) => {
          if (index === 0) return true;
          const previous = all[index - 1];
          if (!previous) return false;
          const firstDifference = version.findIndex(
            (component, componentIndex) =>
              component !== previous[componentIndex],
          );
          if (firstDifference < 0) return false;
          const currentComponent = version[firstDifference];
          const previousComponent = previous[firstDifference];
          return (
            currentComponent !== undefined &&
            previousComponent !== undefined &&
            currentComponent > previousComponent
          );
        }),
    ).toBe(true);
  });

  it.each([
    'v1.2.3-alpha.1',
    'v1.2.3+build.4',
    '1.2',
    'v01.2.3',
    'v1.2.65536',
    '',
  ])('rejects unsupported release tag %s', (tag) => {
    expect(() => msixVersionFromTag(tag)).toThrow();
  });
});
