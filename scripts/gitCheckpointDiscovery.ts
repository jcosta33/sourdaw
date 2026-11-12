import { command, diagnosticEnv } from './gitCheckpointProcess.ts';

const unavailable = 'unavailable';
export function checkpointDiscovery(args: string[]) {
    const separator = args.indexOf('--');
    const paths = args[0] === 'add' && separator >= 0 ? args.slice(separator + 1) : [];
    const options = args.slice(1, separator >= 0 ? separator : undefined);
    const exotic = options.some(
        (arg) =>
            arg === '-p' ||
            arg === '--patch' ||
            arg === '-i' ||
            arg === '--interactive' ||
            arg.startsWith('--pathspec-from-file')
    );
    const includeIgnored = options.some((arg) => arg === '--force' || /^-[^-]*f/.test(arg));
    const trackedOnly = options.some((arg) => arg === '--update' || /^-[^-]*u/.test(arg));
    const discover = args[0] === 'add' && separator >= 0 && !exotic;
    const conservative = args[0] === 'commit' || !discover;
    const includeUntracked = args[0] === 'add' && !trackedOnly;
    return { paths, discover, includeIgnored, trackedOnly, conservative, includeUntracked };
}
export function discoverPathspecs(paths: string[], discover: boolean, includeIgnored: boolean, trackedOnly: boolean) {
    if (!discover) {
        return { matched: [], pathspecDiscovery: 'not requested' };
    }
    const argumentsForListing = ['ls-files', '-z', '--cached'];
    if (!trackedOnly) {
        argumentsForListing.push('--others');
    }
    if (!includeIgnored && !trackedOnly) {
        argumentsForListing.push('--exclude-standard');
    }
    argumentsForListing.push('--', ...new Set(paths));
    const listing = command('git', argumentsForListing, diagnosticEnv, 750, true);
    if (listing === null) {
        return { matched: [], pathspecDiscovery: unavailable };
    }
    return { matched: listing.split('\0').filter(Boolean), pathspecDiscovery: 'complete' };
}
export function discoverWorktreeCandidates(includeUntracked: boolean, includeIgnored: boolean) {
    const changed = command(
        'git',
        ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', '--diff-filter=ACDMRT'],
        diagnosticEnv,
        750,
        true
    );
    let untracked: string | null = null;
    if (includeUntracked) {
        const args = ['ls-files', '-z', '--others'];
        if (!includeIgnored) {
            args.push('--exclude-standard');
        }
        untracked = command('git', args, diagnosticEnv, 750, true);
    }
    const paths = changed?.split('\0').filter(Boolean) ?? [];
    if (untracked !== null) {
        paths.push(...untracked.split('\0').filter(Boolean));
    }
    return {
        paths,
        tracked: changed === null ? unavailable : 'complete',
        untracked: includeUntracked ? (untracked === null ? unavailable : 'complete') : 'not requested',
    };
}

export function selectCheckpointSources(
    paths: string[],
    staged: string | null,
    discover: boolean,
    includeIgnored: boolean,
    trackedOnly: boolean,
    conservative: boolean,
    includeUntracked: boolean
) {
    const stagedPaths = staged?.split('\0').filter(Boolean) ?? [];
    const { matched, pathspecDiscovery } = discoverPathspecs(paths, discover, includeIgnored, trackedOnly);
    let candidates: ReturnType<typeof discoverWorktreeCandidates> | null = null;
    if (conservative) {
        candidates = discoverWorktreeCandidates(includeUntracked, includeIgnored);
    }
    const requestedPaths = discover ? [] : paths;
    const candidatePaths = candidates?.paths ?? [];
    const discovered = [...new Set([...candidatePaths, ...requestedPaths, ...matched, ...stagedPaths])];
    const selected = discovered.slice(0, 256);
    const sourceSelection = {
        selected: selected.length,
        omitted: discovered.length - selected.length,
        stagedDiscovery: staged === null ? unavailable : 'complete',
        pathspecDiscovery,
        mode: conservative ? 'conservative' : discover ? 'explicit' : 'frozen',
        candidateDiscovery:
            candidates === null ? 'not requested' : { tracked: candidates.tracked, untracked: candidates.untracked },
    };
    return { selected, sourceSelection };
}
