import { describe, expect, it } from 'vitest';

import { getIndicoEventUrlFromArgs } from './launchEventUrl';

describe('getIndicoEventUrlFromArgs', () => {
  it('finds and normalizes a directly supplied Indico event URL', () => {
    expect(
      getIndicoEventUrlFromArgs([
        'IndicoInk.exe',
        'https://indico.cern.ch/event/1234/timetable/?view=standard',
      ]),
    ).toBe('https://indico.cern.ch/event/1234');
  });

  it('supports the explicit command-line option forms', () => {
    expect(
      getIndicoEventUrlFromArgs([
        'IndicoInk.exe',
        '--indico-url',
        'https://indico.in2p3.fr/event/40025',
      ]),
    ).toBe('https://indico.in2p3.fr/event/40025');
    expect(
      getIndicoEventUrlFromArgs([
        'IndicoInk.exe',
        '--indico-url=https://indico.cern.ch/event/5678/',
      ]),
    ).toBe('https://indico.cern.ch/event/5678');
  });

  it('passes event-shaped URLs through for runtime Indico detection', () => {
    expect(
      getIndicoEventUrlFromArgs([
        'IndicoInk.exe',
        '--disable-gpu',
        'https://events.cels.anl.gov/event/951/timetable/',
      ]),
    ).toBe('https://events.cels.anl.gov/event/951');
    expect(
      getIndicoEventUrlFromArgs([
        'IndicoInk.exe',
        '--indico-url=not-a-url',
        'https://indico.cern.ch/event/5678',
      ]),
    ).toBeNull();
  });
});
