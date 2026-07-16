import { describe, expect, it } from 'vitest';

import {
  createIndicoEventExportUrl,
  parseIndicoEventLinkUrl,
  parseIndicoEventSessionUrl,
  parseIndicoEventUrl,
} from './indicoEvent';
import { createConferenceId } from './persistenceModels';

describe('parseIndicoEventUrl', () => {
  it('accepts a canonical Indico event URL', () => {
    const identity = parseIndicoEventUrl('https://indico.in2p3.fr/event/35043');

    expect(identity).toEqual({
      eventId: '35043',
      origin: 'https://indico.in2p3.fr',
      canonicalEventUrl: 'https://indico.in2p3.fr/event/35043',
      conferenceId: createConferenceId('https://indico.in2p3.fr/event/35043'),
    });
  });

  it('rejects invalid or non-https URLs', () => {
    expect(parseIndicoEventUrl('')).toBeNull();
    expect(
      parseIndicoEventUrl('http://indico.in2p3.fr/event/35043'),
    ).toBeNull();
    expect(parseIndicoEventUrl('https://example.com/event/35043')).toBeNull();
    expect(
      parseIndicoEventUrl('https://indico.in2p3.fr/category/1'),
    ).toBeNull();
  });

  it('normalizes trailing event paths to the canonical event URL', () => {
    const identity = parseIndicoEventUrl(
      'https://indico.in2p3.fr/event/35043/sessions/22804/?from=agenda',
    );

    expect(identity).toEqual({
      eventId: '35043',
      origin: 'https://indico.in2p3.fr',
      canonicalEventUrl: 'https://indico.in2p3.fr/event/35043',
      conferenceId: createConferenceId('https://indico.in2p3.fr/event/35043'),
    });
  });
});

describe('createIndicoEventExportUrl', () => {
  it('builds a sessions export URL from the parsed identity', () => {
    const identity = parseIndicoEventUrl('https://indico.in2p3.fr/event/35043');
    expect(identity).not.toBeNull();

    expect(
      createIndicoEventExportUrl(identity as NonNullable<typeof identity>),
    ).toBe(
      'https://indico.in2p3.fr/export/event/35043.json?detail=sessions&pretty=yes',
    );
  });

  it('only treats event pages and timetables as in-app event links', () => {
    expect(
      parseIndicoEventLinkUrl('https://indico.example.org/event/123/timetable/')
        ?.canonicalEventUrl,
    ).toBe('https://indico.example.org/event/123');
    expect(
      parseIndicoEventLinkUrl(
        'https://indico.example.org/event/123/sessions/456/',
      ),
    ).toBeNull();
    expect(
      parseIndicoEventSessionUrl(
        'https://indico.example.org/event/123/sessions/456/',
      )?.canonicalEventUrl,
    ).toBe('https://indico.example.org/event/123');
  });
});
