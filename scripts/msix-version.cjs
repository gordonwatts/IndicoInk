const MAX_COMPONENT = 65535;

const msixVersionFromTag = (tag) => {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (!match) {
    throw new Error(
      `Unsupported release tag "${tag}". Use vMAJOR.MINOR.PATCH with numeric components only.`,
    );
  }

  const components = match.slice(1).map(Number);
  if (components.some((component) => component > MAX_COMPONENT)) {
    throw new Error(
      `Release tag "${tag}" exceeds the maximum MSIX version component (${MAX_COMPONENT}).`,
    );
  }

  return `${components.join('.')}.0`;
};

module.exports = { msixVersionFromTag };

if (require.main === module) {
  try {
    const tag = process.argv[2] ?? '';
    process.stdout.write(`${msixVersionFromTag(tag)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
