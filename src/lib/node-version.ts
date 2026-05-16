export const MIN_NODE_MAJOR = 24;

export interface NodeVersionCheck {
  ok: boolean;
  currentMajor: number | undefined;
  requiredMajor: number;
}

export const parseNodeMajor = (version: string): number | undefined => {
  const major = version.replace(/^v/, "").split(".", 1)[0];
  if (!major) return undefined;

  const parsed = Number.parseInt(major, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const checkNodeVersion = (
  version: string,
  requiredMajor = MIN_NODE_MAJOR
): NodeVersionCheck => {
  const currentMajor = parseNodeMajor(version);

  return {
    ok: currentMajor !== undefined && currentMajor >= requiredMajor,
    currentMajor,
    requiredMajor,
  };
};

export const formatNodeVersionError = ({
  currentMajor,
  requiredMajor,
}: NodeVersionCheck): string => {
  const current = currentMajor === undefined ? process.version : `Node ${currentMajor}`;

  return [
    `RepoGarden requires Node ${requiredMajor} or newer.`,
    `You are running ${current}.`,
    "Install a newer Node.js runtime, then run repogarden again.",
  ].join("\n");
};
