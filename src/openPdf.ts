export type PdfSelection = {
  canceled: boolean;
  filePath: string | null;
};

export type PdfDialogResult = {
  filePaths: string[];
};

export type ShowOpenPdfDialog = (
  options: {
    title: string;
    properties: Array<'openFile'>;
    filters: Array<{ name: string; extensions: string[] }>;
  },
) => Promise<PdfDialogResult>;

export const resolvePdfSelection = (paths: string[] | undefined): PdfSelection => {
  if (!paths || paths.length === 0) {
    return { canceled: true, filePath: null };
  }

  return {
    canceled: false,
    filePath: paths[0] ?? null,
  };
};

export const openPdfSelection = async (
  showOpenPdfDialog: ShowOpenPdfDialog,
): Promise<PdfSelection> => {
  const result = await showOpenPdfDialog({
    title: 'Open PDF',
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  return resolvePdfSelection(result.filePaths);
};
