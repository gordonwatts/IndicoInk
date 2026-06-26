const escapePdfText = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');

const buildPdfObject = (id: number, body: string) =>
  `${id} 0 obj\n${body}\nendobj\n`;

export const createFixturePdfBytes = (
  pageCount: number,
  title = 'IndicoInk fixture PDF',
): Uint8Array => {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error(`Invalid fixture PDF page count: ${pageCount}`);
  }

  const header = '%PDF-1.4\n% IndicoInk fixture\n';
  const objects: string[] = [];
  const totalObjects = 3 + pageCount * 2;
  const pageObjectIds = Array.from(
    { length: pageCount },
    (_, index) => 4 + index * 2,
  );

  objects.push(buildPdfObject(1, `<< /Type /Catalog /Pages 2 0 R >>`));
  objects.push(
    buildPdfObject(
      2,
      `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ),
  );
  objects.push(
    buildPdfObject(3, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`),
  );

  for (let index = 0; index < pageCount; index += 1) {
    const pageNumber = index + 1;
    const pageObjectId = pageObjectIds[index]!;
    const contentObjectId = pageObjectId + 1;
    const pageTitle = escapePdfText(`${title} - page ${pageNumber}`);
    const content = [
      'BT',
      '/F1 18 Tf',
      '72 740 Td',
      `/F1 18 Tf`,
      `(${pageTitle}) Tj`,
      '0 -24 Td',
      `/F1 12 Tf`,
      `(${escapePdfText(`Generated for IndicoInk fixtures.`)}) Tj`,
      'ET',
    ].join('\n');
    const contentBody = `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`;
    objects.push(
      buildPdfObject(
        pageObjectId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      ),
    );
    objects.push(buildPdfObject(contentObjectId, contentBody));
  }

  const objectBuffers = objects.map((object) => Buffer.from(object, 'utf8'));
  let offset = Buffer.byteLength(header, 'utf8');
  const xrefEntries = ['0000000000 65535 f \n'];
  for (const objectBuffer of objectBuffers) {
    xrefEntries.push(`${offset.toString().padStart(10, '0')} 00000 n \n`);
    offset += objectBuffer.byteLength;
  }

  const xref = [
    'xref',
    `0 ${totalObjects + 1}`,
    ...xrefEntries,
    'trailer',
    `<< /Size ${totalObjects + 1} /Root 1 0 R >>`,
    'startxref',
    String(offset),
    '%%EOF',
    '',
  ].join('\n');

  return Buffer.concat([
    Buffer.from(header, 'utf8'),
    ...objectBuffers,
    Buffer.from(xref, 'utf8'),
  ]);
};
