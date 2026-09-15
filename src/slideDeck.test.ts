import { describe, expect, it } from 'vitest';

import {
  choosePreferredSlideDeck,
  getGoogleSlidesPdfUrl,
  isGoogleSlidesDeck,
} from './slideDeck';

describe('Google Slides decks', () => {
  it('recognizes editor/share links and converts them to PDF exports', () => {
    const sourceUrl =
      'https://docs.google.com/presentation/d/presentation-123/edit?usp=sharing#slide=id.p';

    expect(isGoogleSlidesDeck(sourceUrl)).toBe(true);
    expect(getGoogleSlidesPdfUrl(sourceUrl)).toBe(
      'https://docs.google.com/presentation/d/presentation-123/export/pdf',
    );
  });

  it('does not classify unrelated Google or insecure URLs as Slides', () => {
    expect(
      isGoogleSlidesDeck('https://docs.google.com/document/d/doc-123/edit'),
    ).toBe(false);
    expect(
      isGoogleSlidesDeck(
        'http://docs.google.com/presentation/d/slides-123/edit',
      ),
    ).toBe(false);
    expect(getGoogleSlidesPdfUrl('https://example.org/slides.pdf')).toBe(
      'https://example.org/slides.pdf',
    );
  });
});

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
