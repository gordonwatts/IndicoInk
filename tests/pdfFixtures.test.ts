import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures', 'pdfs');

const readFixture = (name: string) =>
  readFileSync(join(fixturesDir, name), 'utf8');

describe('PDF fixtures', () => {
  it('includes the expected deterministic fixture set', () => {
    const names = [
      'image-heavy.pdf',
      'multi-page.pdf',
      'one-page.pdf',
      'text-heavy.pdf',
    ];

    for (const name of names) {
      const bytes = readFixture(name);
      expect(bytes.startsWith('%PDF-1.4')).toBe(true);
      expect(bytes).toContain('/Type /Catalog');
      expect(bytes).toContain('/Type /Pages');
      expect(bytes).toContain('startxref');
    }
  });

  it('distinguishes the one-page, multi-page, text-heavy, and image-heavy cases', () => {
    const onePage = readFixture('one-page.pdf');
    const multiPage = readFixture('multi-page.pdf');
    const textHeavy = readFixture('text-heavy.pdf');
    const imageHeavy = readFixture('image-heavy.pdf');

    expect(onePage.match(/\/Type \/Page\b/g)?.length).toBe(1);
    expect(multiPage.match(/\/Type \/Page\b/g)?.length).toBe(3);
    expect(textHeavy.match(/Line 28:/g)?.length).toBe(1);
    expect(imageHeavy).toContain('/ASCIIHexDecode');
    expect(imageHeavy).toContain('BI');
  });
});
