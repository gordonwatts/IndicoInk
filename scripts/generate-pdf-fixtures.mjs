import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const outputDir = join(process.cwd(), 'tests', 'fixtures', 'pdfs');

const ensureDir = (filePath) => {
  mkdirSync(dirname(filePath), { recursive: true });
};

const buildPdf = ({ pages, resources = '', extraObjects = [] }) => {
  const objects = [];

  const addObject = (body) => {
    const id = objects.length + 1;
    objects.push(`${id} 0 obj\n${body}\nendobj\n`);
    return id;
  };

  const fontId = addObject(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  );
  extraObjects.forEach((body) => {
    addObject(body);
  });

  const pageContentIds = [];
  const pageIds = [];

  for (const page of pages) {
    const stream = page.content.join('\n');
    const contentId = addObject(
      `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`,
    );
    pageContentIds.push(contentId);
  }

  const pagesIdPlaceholder = objects.length + pages.length + 1;
  for (const page of pages) {
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesIdPlaceholder} 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 ${fontId} 0 R >> ${resources} >> /Contents ${pageContentIds[pageIds.length]} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  const kids = pageIds.map((id) => `${id} 0 R`).join(' ');
  const pagesId = addObject(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [ ${kids} ] >>`,
  );

  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const orderedObjects = objects.map((object, index) => ({
    id: index + 1,
    body: object,
  }));

  const header = '%PDF-1.4\n% IndicoInk fixtures\n';
  let offset = Buffer.byteLength(header, 'utf8');
  const chunks = [header];
  const xrefOffsets = [0];

  for (const object of orderedObjects) {
    xrefOffsets.push(offset);
    chunks.push(object.body);
    offset += Buffer.byteLength(object.body, 'utf8');
  }

  const xrefStart = offset;
  chunks.push(`xref\n0 ${orderedObjects.length + 1}\n`);
  chunks.push('0000000000 65535 f \n');
  for (const xrefOffset of xrefOffsets.slice(1)) {
    chunks.push(`${String(xrefOffset).padStart(10, '0')} 00000 n \n`);
  }

  chunks.push(
    `trailer\n<< /Size ${orderedObjects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  );

  return chunks.join('');
};

const makeInlineImage = () => {
  const width = 48;
  const height = 48;
  const hex = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const checker = ((x >> 3) + (y >> 3)) % 2 === 0;
      const color = checker ? [0x36, 0x60, 0x96] : [0xbc, 0xd2, 0xe8];
      hex.push(
        color.map((channel) => channel.toString(16).padStart(2, '0')).join(''),
      );
    }
  }

  return `q 460 0 0 460 45 140 cm
BI
/W ${width}
/H ${height}
/CS /RGB
/BPC 8
/F [/ASCIIHexDecode]
ID
${hex.join('').toUpperCase()}>
EI
Q`;
};

const writeFixture = (name, pdf) => {
  const target = join(outputDir, name);
  ensureDir(target);
  writeFileSync(target, pdf, 'binary');
};

const onePage = buildPdf({
  pages: [
    {
      width: 612,
      height: 792,
      content: [
        'BT',
        '/F1 18 Tf',
        '72 720 Td',
        '(IndicoInk fixture: one page) Tj',
        '0 -28 Td',
        '/F1 12 Tf',
        '(This page exists to validate a single-page PDF path.) Tj',
        'ET',
      ],
    },
  ],
});

const multiPage = buildPdf({
  pages: [
    {
      width: 612,
      height: 792,
      content: [
        'BT',
        '/F1 18 Tf',
        '72 720 Td',
        '(Multi-page fixture: page 1) Tj',
        '0 -28 Td',
        '/F1 12 Tf',
        '(Page 1 of 3.) Tj',
        'ET',
      ],
    },
    {
      width: 612,
      height: 792,
      content: [
        'BT',
        '/F1 18 Tf',
        '72 720 Td',
        '(Multi-page fixture: page 2) Tj',
        '0 -28 Td',
        '/F1 12 Tf',
        '(Page 2 of 3.) Tj',
        'ET',
      ],
    },
    {
      width: 612,
      height: 792,
      content: [
        'BT',
        '/F1 18 Tf',
        '72 720 Td',
        '(Multi-page fixture: page 3) Tj',
        '0 -28 Td',
        '/F1 12 Tf',
        '(Page 3 of 3.) Tj',
        'ET',
      ],
    },
  ],
});

const textHeavy = buildPdf({
  pages: [
    {
      width: 612,
      height: 792,
      content: [
        'BT',
        '/F1 18 Tf',
        '72 730 Td',
        '(Text-heavy fixture) Tj',
        '0 -24 Td',
        '/F1 10 Tf',
        ...Array.from(
          { length: 28 },
          (_, index) =>
            `0 -18 Td (Line ${String(index + 1).padStart(2, '0')}: repeated talk-title and metadata text for layout stress testing.) Tj`,
        ),
        'ET',
      ],
    },
  ],
});

const imageHeavy = buildPdf({
  pages: [
    {
      width: 612,
      height: 792,
      content: [
        'BT',
        '/F1 18 Tf',
        '72 730 Td',
        '(Image-heavy fixture) Tj',
        '0 -24 Td',
        '/F1 10 Tf',
        '(The page includes one large raster image object for rendering tests.) Tj',
        'ET',
        makeInlineImage(),
      ],
    },
  ],
});

writeFixture('one-page.pdf', onePage);
writeFixture('multi-page.pdf', multiPage);
writeFixture('text-heavy.pdf', textHeavy);
writeFixture('image-heavy.pdf', imageHeavy);

console.log(`Wrote PDF fixtures to ${outputDir}`);
