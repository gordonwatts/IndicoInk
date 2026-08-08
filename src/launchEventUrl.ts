import { parseIndicoEventUrl } from './indicoEvent';

const readOptionValue = (argv: string[], optionName: string) => {
  const optionIndex = argv.findIndex(
    (value) => value === optionName || value.startsWith(`${optionName}=`),
  );
  if (optionIndex < 0) {
    return null;
  }

  const option = argv[optionIndex] ?? '';
  if (option.includes('=')) {
    return option.slice(option.indexOf('=') + 1).trim() || null;
  }

  return argv[optionIndex + 1]?.trim() || null;
};

export const getIndicoEventUrlFromArgs = (argv: string[]) => {
  const explicitUrl = readOptionValue(argv, '--indico-url');
  if (explicitUrl) {
    return parseIndicoEventUrl(explicitUrl)?.canonicalEventUrl ?? null;
  }

  for (const argument of argv) {
    const identity = parseIndicoEventUrl(argument);
    if (identity) {
      return identity.canonicalEventUrl;
    }
  }

  return null;
};
