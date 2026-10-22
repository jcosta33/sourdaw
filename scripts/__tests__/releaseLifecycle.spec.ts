import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { cutRelease, type CutReleasePort } from '../cutRelease.ts';
import { DEPENDENCY_LICENSE_PROOFS_PATH } from '../dependencyLicenseReport.ts';
import { AUTHOR_BOT_NODE_ID } from '../githubAppIdentity.ts';
import { proposeRelease, type ProposeReleasePort } from '../proposeRelease.ts';
import {
    CHANGELOG_PATH,
    CHANGELOG_PREAMBLE,
    RELEASE_INVENTORY_PATH,
    changelogSectionBody,
    parseSemanticVersion,
    releaseCommitSubject,
    type MergedPullRequest,
} from '../releaseVersion.ts';

/**
 * One repository, walked through the whole release lifecycle. `main` is its first-parent merge
 * order; a commit is an index into it, and every merge snapshots the tree at that index so `cut`
 * reads what the revision it is tagging actually holds — which is the only way the changelog and
 * the notes can be checked against each other the way the real path checks them.
 */
type Repository = {
    tags: string[];
    releases: string[];
    main: MergedPullRequest[];
    trees: { manifest: string; changelog: string }[];
    files: Record<string, string>;
    tagged: { tag: string; commit: string }[];
};

const manifestFor = (version: string) => `{\n    "name": "sourdaw",\n    "version": "${version}"\n}\n`;
const proofsFor = (digest: string) => `{\n    "path": "package.json",\n    "sha256": "${digest}"\n}\n`;
const inventoryFor = (manifestDigest: string, proofsDigest: string) =>
    `{\n    "digests": ["sha256:${proofsDigest}:${DEPENDENCY_LICENSE_PROOFS_PATH}"],\n    "path": "package.json",\n    "sha256": "${manifestDigest}"\n}\n`;

const sha256 = (contents: string) => createHash('sha256').update(contents, 'utf8').digest('hex');
const commitOf = (index: number) => String(index).padStart(40, '0');
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

const RELEASED_CHANGELOG = `${CHANGELOG_PREAMBLE}\n## v0.2.0 - 2026-08-01\n\n### Features\n\n- feat(engine): the released one (#1)\n`;

function repository(): Repository {
    const manifest = manifestFor('0.2.0');
    return {
        tags: ['v0.2.0'],
        releases: ['v0.2.0'],
        main: [{ number: 2, title: releaseCommitSubject('0.2.0') }],
        trees: [{ manifest, changelog: RELEASED_CHANGELOG }],
        files: {
            'package.json': manifest,
            [CHANGELOG_PATH]: RELEASED_CHANGELOG,
            [DEPENDENCY_LICENSE_PROOFS_PATH]: proofsFor(sha256(manifest)),
            [RELEASE_INVENTORY_PATH]: inventoryFor(sha256(manifest), sha256(proofsFor(sha256(manifest)))),
        },
        tagged: [],
    };
}

/** An ordinary pull request merging into `main`; the tree at that commit is unchanged. */
function merge(repo: Repository, pullRequest: MergedPullRequest): void {
    repo.main.push(pullRequest);
    repo.trees.push(repo.trees.at(-1) ?? { manifest: '', changelog: '' });
}

/** The release pull request merging: `main` takes the lane's tree, and that tree is the snapshot. */
function mergeRelease(repo: Repository, number: number, version: string): string {
    repo.main.push({ number, title: releaseCommitSubject(version) });
    repo.trees.push({
        manifest: repo.files['package.json'] ?? '',
        changelog: repo.files[CHANGELOG_PATH] ?? '',
    });
    return commitOf(repo.main.length - 1);
}

/** A fresh lane branched from `main`, which is what an operator opens to re-propose. */
function openLane(repo: Repository): void {
    const tree = repo.trees.at(-1);
    repo.files['package.json'] = tree?.manifest ?? '';
    repo.files[CHANGELOG_PATH] = tree?.changelog ?? '';
}

function tagIndex(repo: Repository, tag: string | undefined): number {
    if (tag === undefined) {
        return -1;
    }
    const index = repo.main.findIndex((pullRequest) => pullRequest.title === releaseCommitSubject(tag.slice(1)));
    return index < 0 ? -1 : index;
}

function proposePort(repo: Repository, today: string): ProposeReleasePort {
    return {
        releaseTags: () => [...repo.tags],
        versionAtBase: () => parseVersionOf(repo.trees.at(-1)?.manifest ?? ''),
        mergedPullRequests: (previousTag) => repo.main.slice(tagIndex(repo, previousTag) + 1),
        readWorkspaceFile: (path) => repo.files[path] ?? '',
        writeWorkspaceFile: (path, contents) => {
            repo.files[path] = contents;
        },
        digest: sha256,
        today: () => today,
        log: () => undefined,
    };
}

function parseVersionOf(manifest: string): string {
    return /"version": "([^"]+)"/.exec(manifest)?.[1] ?? '';
}

function cutPort(repo: Repository): CutReleasePort {
    const indexOf = (commit: string) => Number(commit);
    return {
        tagNames: () => [...repo.tags],
        releasedTagNames: () => [...repo.releases],
        latestReleaseTag: () => repo.tags.at(-1),
        commitIsOnMain: (commit) => indexOf(commit) < repo.main.length,
        manifestVersionAt: (commit) => parseVersionOf(repo.trees[indexOf(commit)]?.manifest ?? ''),
        changelogAt: (commit) => repo.trees[indexOf(commit)]?.changelog ?? '',
        mergedPullRequests: (previousTag, commit) =>
            repo.main.slice(tagIndex(repo, previousTag) + 1, indexOf(commit) + 1),
        releasePullRequestAt: (commit) => repo.main[indexOf(commit)]?.number,
        createTag: (tag, commit) => {
            repo.tags.push(tag);
            repo.tagged.push({ tag, commit });
            return { tagObjectSha: 'b'.repeat(40), refSha: 'b'.repeat(40), refName: `refs/tags/${tag}` };
        },
        createRelease: (tag, commit) => {
            repo.releases.push(tag);
            return { id: repo.releases.length, tagName: tag, targetCommitish: commit, draft: false };
        },
        log: () => undefined,
    };
}

describe('release lifecycle', () => {
    it('recovers from a drift refusal and cuts the release on the second proposal', () => {
        const repo = repository();
        merge(repo, { number: 10, title: 'fix(arrangement): preserve reorder track state' });
        merge(repo, { number: 20, title: 'feat(mixer): add a post-fader send' });

        expect(proposeRelease(proposePort(repo, '2026-08-28'))?.version).toBe('0.3.0');
        const firstProposal = repo.files[CHANGELOG_PATH] ?? '';
        expect(changelogSectionBody(firstProposal, parseSemanticVersion('0.3.0', 'x'))).toContain('(#20)');

        // A pull request lands while the release pull request is in review.
        merge(repo, { number: 30, title: 'fix(engine): stop drift' });
        const firstRelease = mergeRelease(repo, 40, '0.3.0');

        expect(() => cutRelease('0.3.0', firstRelease, AUTHOR_BOT_NODE_ID, cutPort(repo))).toThrow(
            'does not match the notes for the v0.3.0 range'
        );
        expect(repo.tagged).toEqual([]);

        // The named repair: re-propose from a lane branched off the merged-but-uncut main.
        openLane(repo);
        expect(proposeRelease(proposePort(repo, '2026-09-04'))?.version).toBe('0.3.0');
        const secondProposal = repo.files[CHANGELOG_PATH] ?? '';
        expect(occurrences(secondProposal, '## v0.3.0')).toBe(1);
        expect(secondProposal).toContain('## v0.2.0');
        for (const reference of ['(#10)', '(#20)', '(#30)', '(#40)']) {
            expect(occurrences(secondProposal, reference)).toBe(1);
        }

        const secondRelease = mergeRelease(repo, 50, '0.3.0');
        expect(cutRelease('0.3.0', secondRelease, AUTHOR_BOT_NODE_ID, cutPort(repo))).toBe(
            `release-cut:v0.3.0:${secondRelease}`
        );
        expect(repo.tagged).toEqual([{ tag: 'v0.3.0', commit: secondRelease }]);
    });

    it('agrees with the proposal when the range holds an earlier release commit for the same version', () => {
        const repo = repository();
        merge(repo, { number: 10, title: 'fix(arrangement): preserve reorder track state' });
        merge(repo, { number: 20, title: 'feat(mixer): add a post-fader send' });
        proposeRelease(proposePort(repo, '2026-08-28'));
        mergeRelease(repo, 40, '0.3.0');

        openLane(repo);
        proposeRelease(proposePort(repo, '2026-09-04'));
        const committed = changelogSectionBody(repo.files[CHANGELOG_PATH] ?? '', parseSemanticVersion('0.3.0', 'x'));
        const secondRelease = mergeRelease(repo, 50, '0.3.0');

        const notes: string[] = [];
        const port = cutPort(repo);
        cutRelease('0.3.0', secondRelease, AUTHOR_BOT_NODE_ID, {
            ...port,
            createRelease: (tag, commit, body) => {
                notes.push(body);
                return port.createRelease(tag, commit, body);
            },
        });
        expect(notes[0]).toBe(committed);
        expect(notes[0]).toContain(`- ${releaseCommitSubject('0.3.0')} (#40)`);
        expect(notes[0]).not.toContain('(#50)');
    });
});
