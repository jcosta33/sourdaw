import { REQUIRED_BASE_BRANCH, REQUIRED_REPOSITORY, parseGraphqlResponse, parseJson } from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import { latestReleaseTagOf, squashedPullRequestNumbers, type MergedPullRequest } from './releaseVersion.ts';

/** A captured command. Both readers are supplied by the caller, which owns cwd and credentials. */
export type CommandReader = (args: string[]) => string;

/**
 * GitHub numbers issues and pull requests in one sequence, so a `(#N)` reference resolved here can
 * name an issue. `pullRequest(number:)` answers `null` for one, which is the signal that the
 * reference was never a merged pull request rather than a title that failed to load.
 */
const PULL_REQUEST_BATCH_SIZE = 50;

function repositoryOwnerAndName(): { owner: string; name: string } {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    return { owner, name };
}

function nonEmptyLines(output: string): string[] {
    return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
}

/** Every `v`-prefixed tag GitHub holds, as tag names. */
export function releaseTagNames(gh: CommandReader): string[] {
    const output = gh([
        'api',
        '--paginate',
        `repos/${REQUIRED_REPOSITORY}/git/matching-refs/tags/v`,
        '--jq',
        '.[].ref',
    ]);
    return nonEmptyLines(output).map((ref) => ref.replace(/^refs\/tags\//, ''));
}

export function latestReleaseTag(gh: CommandReader): string | undefined {
    return latestReleaseTagOf(releaseTagNames(gh));
}

export function releaseTagNamesWithReleases(gh: CommandReader): string[] {
    return nonEmptyLines(gh(['api', '--paginate', `repos/${REQUIRED_REPOSITORY}/releases`, '--jq', '.[].tag_name']));
}

/**
 * Whether `main` already contains the commit. This is the one question a local ref cannot answer:
 * `refs/remotes/origin/main` is only as fresh as the last fetch, and tagging a revision that never
 * reached the protected branch is exactly what the guard exists to refuse.
 */
export function commitIsOnMainBranch(commit: string, gh: CommandReader): boolean {
    const status = gh([
        'api',
        `repos/${REQUIRED_REPOSITORY}/compare/${REQUIRED_BASE_BRANCH}...${commit}`,
        '--jq',
        '.status',
    ]).trim();
    return status === 'identical' || status === 'behind';
}

export function assertRevisionPresent(revision: string, git: CommandReader): void {
    try {
        git(['cat-file', '-e', `${revision}^{commit}`]);
    } catch {
        fail(`${revision} is not present locally; run git fetch origin main --tags first`);
    }
}

export function fileAtRevision(revision: string, path: string, git: CommandReader): string {
    try {
        return git(['show', `${revision}:${path}`]);
    } catch {
        return fail(`${path} cannot be read at ${revision}`);
    }
}

/**
 * The first-parent subjects a tag range added. First parent is what makes this the merge history of
 * `main`: every squash merge is one commit on it, and nothing a feature branch carried underneath
 * is counted twice.
 */
export function squashedSubjectsInRange(
    previousTag: string | undefined,
    revision: string,
    git: CommandReader
): string[] {
    const range = previousTag === undefined ? revision : `${previousTag}..${revision}`;
    return nonEmptyLines(git(['log', '--first-parent', '--format=%s', range]));
}

/**
 * The pull request one commit's own squash subject names. Cut asks this of the revision it is
 * tagging, which is how the release pull request is identified by number rather than by a subject
 * a second release of the same version would repeat.
 */
export function squashedPullRequestAt(commit: string, git: CommandReader): number | undefined {
    return squashedPullRequestNumbers(nonEmptyLines(git(['log', '-1', '--format=%s', commit])))[0];
}

function pullRequestBatches(numbers: readonly number[]): number[][] {
    const batches: number[][] = [];
    for (let start = 0; start < numbers.length; start += PULL_REQUEST_BATCH_SIZE) {
        batches.push(numbers.slice(start, start + PULL_REQUEST_BATCH_SIZE));
    }
    return batches;
}

function batchQuery(numbers: readonly number[]): string {
    const fields = numbers
        .map((number) => `pr${String(number)}: pullRequest(number: ${String(number)}) { number title state }`)
        .join(' ');
    return `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${fields}}}`;
}

type PullRequestNode = { number?: unknown; title?: unknown; state?: unknown };

function mergedPullRequestFrom(value: unknown, expected: number): MergedPullRequest | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    const node = value as PullRequestNode;
    if (node.number !== expected || typeof node.title !== 'string' || typeof node.state !== 'string') {
        fail(`pull request #${String(expected)} query returned an invalid result`);
    }
    return node.state === 'MERGED' ? { number: expected, title: node.title } : undefined;
}

/** The titles GitHub holds for a set of pull requests, read straight from the pull requests. */
export function mergedPullRequestTitles(numbers: readonly number[], gh: CommandReader): MergedPullRequest[] {
    const { owner, name } = repositoryOwnerAndName();
    return pullRequestBatches(numbers).flatMap((batch) => {
        const response = parseGraphqlResponse<{ data?: { repository?: Record<string, unknown> } }>(
            gh(['api', 'graphql', '-f', `query=${batchQuery(batch)}`, '-F', `owner=${owner}`, '-F', `name=${name}`]),
            'merged pull-request titles'
        );
        const repository = response.data?.repository;
        if (repository === undefined || repository === null) {
            fail('merged pull-request titles query returned no repository');
        }
        return batch.flatMap((number) => {
            const merged = mergedPullRequestFrom(repository[`pr${String(number)}`], number);
            return merged === undefined ? [] : [merged];
        });
    });
}

/**
 * The merged pull requests a tag range contains: the range names them, and GitHub supplies their
 * titles. The subject a squash left behind is only used to identify the pull request — never as the
 * text of a note, which always comes from the pull request itself.
 */
export function mergedPullRequestsInRange(
    previousTag: string | undefined,
    revision: string,
    git: CommandReader,
    gh: CommandReader
): MergedPullRequest[] {
    const numbers = squashedPullRequestNumbers(squashedSubjectsInRange(previousTag, revision, git));
    return mergedPullRequestTitles(numbers, gh);
}

export function manifestVersionAtRevision(revision: string, git: CommandReader): string {
    const manifest = parseJson<{ version?: unknown }>(
        fileAtRevision(revision, 'package.json', git),
        `package.json at ${revision}`
    );
    if (typeof manifest.version !== 'string') {
        fail(`package.json at ${revision} does not carry a version`);
    }
    return manifest.version;
}
