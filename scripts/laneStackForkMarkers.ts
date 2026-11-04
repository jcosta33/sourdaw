export type GitConfigReader = (args: string[]) => string;

export function readLaneStackForkMarkers(branch: string, git: GitConfigReader): string[] {
    const key = `branch.${branch}.sourdaw-stack-fork`;
    const escaped = key.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A scalar config read hides earlier values. Include the repository-format key so absence is a successful read.
    return git(['config', '--null', '--get-regexp', `^(core\\.repositoryformatversion|${escaped})$`])
        .split('\0')
        .filter((entry) => entry.startsWith(`${key}\n`))
        .map((entry) => entry.slice(key.length + 1));
}
