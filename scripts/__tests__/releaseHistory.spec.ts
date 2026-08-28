import { describe, expect, it } from 'vitest';

import {
    commitIsOnMainBranch,
    latestReleaseTag,
    manifestVersionAtRevision,
    mergedPullRequestsInRange,
    releaseTagNames,
    releaseTagNamesWithReleases,
    squashedSubjectsInRange,
    type CommandReader,
} from '../releaseHistory.ts';

const head = 'a'.repeat(40);
const previousTag = 'v0.2.0';

/**
 * What `main` looked like before and after `v0.2.0`. The two ranges answer with different sets, so
 * a reader that builds the wrong range gets the wrong subjects back rather than the same ones.
 */
const BEFORE_TAG = [
    'feat(engine): land before the tag (#100)',
    'fix(mixer): also before the tag (#101)',
    'chore(release): 0.2.0 (#102)',
];
const AFTER_TAG = [
    'fix(arrangement): preserve reorder track state (#200)',
    'feat(mixer): add a post-fader send (#201)',
    'chore: a subject with no merge reference',
];

const PULL_REQUEST_TITLES: Record<number, { title: string; state: string } | null> = {
    200: { title: 'fix(arrangement): preserve reorder track state', state: 'MERGED' },
    201: { title: 'feat(mixer): add a post-fader send', state: 'MERGED' },
    100: { title: 'feat(engine): land before the tag', state: 'MERGED' },
    101: { title: 'fix(mixer): also before the tag', state: 'MERGED' },
    102: { title: 'chore(release): 0.2.0', state: 'MERGED' },
    // The number that names an issue rather than a pull request.
    300: null,
    // A pull request that was closed without merging.
    301: { title: 'feat: never landed', state: 'CLOSED' },
};

function graphqlAnswer(query: string): string {
    const numbers = [...query.matchAll(/pullRequest\(number: ([0-9]+)\)/g)].map((match) => Number(match[1]));
    const repository = Object.fromEntries(
        numbers.map((number) => {
            const record = PULL_REQUEST_TITLES[number] ?? null;
            return [`pr${String(number)}`, record === null ? null : { number, ...record }];
        })
    );
    return JSON.stringify({ data: { repository } });
}

type Recorder = { git: CommandReader; gh: CommandReader; calls: string[] };

function readers(overrides: Record<string, string> = {}): Recorder {
    const calls: string[] = [];
    const git: CommandReader = (args) => {
        const key = args.join(' ');
        calls.push(`git ${key}`);
        const override = overrides[`git ${key}`];
        if (override !== undefined) {
            return override;
        }
        if (key === `log --first-parent --format=%s ${previousTag}..${head}`) {
            return `${AFTER_TAG.join('\n')}\n`;
        }
        if (key === `log --first-parent --format=%s ${head}`) {
            return `${[...AFTER_TAG, ...BEFORE_TAG].join('\n')}\n`;
        }
        if (key === `show ${head}:package.json`) {
            return '{\n    "name": "sourdaw",\n    "version": "0.3.0"\n}\n';
        }
        if (key === `show ${head}:CHANGELOG.md`) {
            return '# Changelog\n';
        }
        throw new Error(`unexpected git invocation: ${key}`);
    };
    const gh: CommandReader = (args) => {
        const key = args.join(' ');
        calls.push(`gh ${key}`);
        const override = overrides[`gh ${key}`];
        if (override !== undefined) {
            return override;
        }
        const query = args.find((argument) => argument.startsWith('query=query('));
        if (query !== undefined) {
            return graphqlAnswer(query);
        }
        if (key.includes('git/matching-refs/tags/v')) {
            return 'refs/tags/v0.1.0\nrefs/tags/v0.2.0\nrefs/tags/vendor-pin\n';
        }
        if (key.includes('/releases ')) {
            return 'v0.1.0\nv0.2.0\n';
        }
        if (key.includes('/compare/main...')) {
            return 'behind\n';
        }
        throw new Error(`unexpected gh invocation: ${key}`);
    };
    return { git, gh, calls };
}

describe('tag-range subjects', () => {
    it('asks git only for the commits the tag range added', () => {
        const { git, calls } = readers();
        expect(squashedSubjectsInRange(previousTag, head, git)).toEqual(AFTER_TAG);
        expect(calls).toEqual([`git log --first-parent --format=%s ${previousTag}..${head}`]);
    });

    it('returns no subject that predates the tag', () => {
        const { git } = readers();
        const subjects = squashedSubjectsInRange(previousTag, head, git);
        for (const subject of BEFORE_TAG) {
            expect(subjects).not.toContain(subject);
        }
    });

    it('walks the whole history only when no release tag exists', () => {
        const { git, calls } = readers();
        expect(squashedSubjectsInRange(undefined, head, git)).toEqual([...AFTER_TAG, ...BEFORE_TAG]);
        expect(calls).toEqual([`git log --first-parent --format=%s ${head}`]);
    });
});

describe('merged pull requests in a range', () => {
    it('resolves only the pull requests the range names, by title, from GitHub', () => {
        const { git, gh } = readers();
        expect(mergedPullRequestsInRange(previousTag, head, git, gh)).toEqual([
            { number: 200, title: 'fix(arrangement): preserve reorder track state' },
            { number: 201, title: 'feat(mixer): add a post-fader send' },
        ]);
    });

    it('carries every pull request of the whole history when there is no tag to bound it', () => {
        const { git, gh } = readers();
        expect(mergedPullRequestsInRange(undefined, head, git, gh).map(({ number }) => number)).toEqual([
            100, 101, 102, 200, 201,
        ]);
    });

    it('drops a reference that is an issue or an unmerged pull request', () => {
        const { git, gh } = readers({
            [`git log --first-parent --format=%s ${previousTag}..${head}`]:
                'fix: real (#200)\ndocs: names an issue (#300)\nfeat: never landed (#301)\n',
        });
        expect(mergedPullRequestsInRange(previousTag, head, git, gh)).toEqual([
            { number: 200, title: 'fix(arrangement): preserve reorder track state' },
        ]);
    });

    it('refuses a title GitHub returns under the wrong number', () => {
        const { git, gh } = readers({
            'gh api graphql': '',
        });
        const mismatched: CommandReader = (args) =>
            args.includes('graphql')
                ? JSON.stringify({ data: { repository: { pr200: { number: 999, title: 'x', state: 'MERGED' } } } })
                : gh(args);
        expect(() =>
            mergedPullRequestsInRange(
                previousTag,
                head,
                (args) =>
                    args.join(' ') === `log --first-parent --format=%s ${previousTag}..${head}`
                        ? 'fix: real (#200)\n'
                        : git(args),
                mismatched
            )
        ).toThrow('pull request #200 query returned an invalid result');
    });
});

describe('release tags', () => {
    it('reads the v-prefixed refs and keeps the highest release tag', () => {
        const { gh } = readers();
        expect(releaseTagNames(gh)).toEqual(['v0.1.0', 'v0.2.0', 'vendor-pin']);
        expect(latestReleaseTag(gh)).toBe('v0.2.0');
        expect(releaseTagNamesWithReleases(gh)).toEqual(['v0.1.0', 'v0.2.0']);
    });
});

describe('main membership', () => {
    it('accepts a commit main already contains and refuses one it does not', () => {
        const { gh } = readers();
        expect(commitIsOnMainBranch(head, gh)).toBe(true);
        const diverged = readers({ [`gh api repos/jcosta33/sourdaw/compare/main...${head} --jq .status`]: 'ahead\n' });
        expect(commitIsOnMainBranch(head, diverged.gh)).toBe(false);
    });
});

describe('manifest at a revision', () => {
    it('reads the version recorded at that exact revision', () => {
        const { git } = readers();
        expect(manifestVersionAtRevision(head, git)).toBe('0.3.0');
    });

    it('refuses a revision whose manifest cannot be read', () => {
        expect(() =>
            manifestVersionAtRevision(head, () => {
                throw new Error('fatal: path does not exist');
            })
        ).toThrow(`package.json cannot be read at ${head}`);
    });
});
