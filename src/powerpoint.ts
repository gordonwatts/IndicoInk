import { spawn } from 'node:child_process';

const quotePowerShellLiteral = (value: string) =>
  `'${value.replaceAll("'", "''")}'`;

export type PowerPointConversionProgress = (message: string) => void;

export const buildPowerPointConversionScript = (
  inputPath: string,
  outputPath: string,
) => {
  const input = quotePowerShellLiteral(inputPath);
  const output = quotePowerShellLiteral(outputPath);
  return [
    '$ErrorActionPreference = "Stop"',
    '$powerPoint = $null',
    '$presentation = $null',
    'try {',
    '  $powerPoint = New-Object -ComObject PowerPoint.Application',
    '  # Some Office builds reject hiding the PowerPoint application window.',
    `  $presentation = $powerPoint.Presentations.Open(${input}, [Microsoft.Office.Core.MsoTriState]::msoTrue, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse)`,
    '  Write-Output "Presentation opened"',
    `  $presentation.SaveAs(${output}, 32)`,
    '  Write-Output "PDF saved"',
    '} finally {',
    '  if ($presentation -ne $null) { $presentation.Close() }',
    '  if ($powerPoint -ne $null) { $powerPoint.Quit() }',
    '}',
  ].join('\n');
};

/** Convert a downloaded PowerPoint presentation using the installed Windows COM server. */
export const convertPowerPointToPdf = async (
  inputPath: string,
  outputPath: string,
  onProgress?: PowerPointConversionProgress,
) => {
  if (process.platform !== 'win32') {
    throw new Error('PowerPoint conversion is only supported on Windows.');
  }

  onProgress?.('Opening PowerPoint...');
  const script = buildPowerPointConversionScript(inputPath, outputPath);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script,
      ],
      { windowsHide: true },
    );
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      const message = chunk.toString().trim();
      if (message) {
        onProgress?.(message);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      reject(
        new Error(`Unable to start PowerPoint conversion: ${error.message}`, {
          cause: error,
        }),
      );
    });
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const detail = stderr.trim();
      reject(
        new Error(
          detail
            ? `PowerPoint conversion failed: ${detail}`
            : `PowerPoint conversion failed with exit code ${code ?? 'unknown'}.`,
        ),
      );
    });
  });
};
