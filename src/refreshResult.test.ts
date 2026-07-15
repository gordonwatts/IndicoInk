import { describe, expect, it } from 'vitest';

import { parseIndicoEventUrl } from './indicoEvent';
import { IndicoHttpError } from './indicoHttp';
import { classifyRefreshError } from './refreshResult';

describe('classifyRefreshError', () => {
  const identity = parseIndicoEventUrl(
    'https://indico.example.org/event/refresh-2026',
  );

  it('returns a typed refresh result for an authentication failure', () => {
    expect(identity).not.toBeNull();

    const result = classifyRefreshError(
      new IndicoHttpError(
        'forbidden',
        403,
        '{"error":"insufficient_scope"}',
      ),
      identity!,
    );

    expect(result).toEqual({
      kind: 'api-key-required',
      conferenceId: identity!.conferenceId,
      origin: 'https://indico.example.org',
      message:
        'This API token needs Indico legacy API read access before this event can be opened.',
    });
  });

  it('leaves unrelated refresh failures for the existing error path', () => {
    expect(
      classifyRefreshError(new Error('network unavailable'), identity!),
    ).toBeNull();
  });
});
