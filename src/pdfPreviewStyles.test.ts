import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('PDF preview styles', () => {
  it('removes collapsed build slides from the document layout', () => {
    const styles = readFileSync(resolve('src', 'styles.css'), 'utf8');

    expect(styles).toMatch(
      /\.pdf-preview-page\[hidden\]\s*\{\s*display:\s*none;\s*\}/,
    );
  });
});
