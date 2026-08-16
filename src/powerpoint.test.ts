import { describe, expect, it } from 'vitest';

import { buildPowerPointConversionScript } from './powerpoint';

describe('PowerPoint conversion script', () => {
  it('uses Office MsoTriState values for presentation opening', () => {
    const script = buildPowerPointConversionScript(
      String.raw`C:\slides\talk.pptx`,
      String.raw`C:\slides\talk.pdf`,
    );

    expect(script).toContain('[Microsoft.Office.Core.MsoTriState]::msoTrue');
    expect(script).not.toContain('.Visible =');
    expect(script).toContain("'C:\\slides\\talk.pptx'");
  });
});
