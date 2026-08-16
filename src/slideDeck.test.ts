import { describe, expect, it } from 'vitest';

import { choosePreferredSlideDeck } from './slideDeck';

describe('choosePreferredSlideDeck', () => {
  it('prefers a PDF over a selected PowerPoint deck', () => {
    const selected = choosePreferredSlideDeck([
      {
        title: 'PowerPoint slides',
        url: 'https://example.org/slides.pptx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        selected: true,
      },
      {
        title: 'PDF slides',
        url: 'https://example.org/slides.pdf',
        mimeType: 'application/pdf',
        selected: false,
      },
    ]);

    expect(selected?.title).toBe('PDF slides');
  });

  it('uses PowerPoint when it is the only available slide deck', () => {
    const selected = choosePreferredSlideDeck([
      {
        title: 'PowerPoint slides',
        url: 'https://example.org/slides.pptx',
        mimeType: 'application/octet-stream',
        selected: true,
      },
    ]);

    expect(selected?.title).toBe('PowerPoint slides');
  });
});
