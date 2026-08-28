import { describe, expect, it } from 'vitest';

import { cutRelease, parseCutReleaseArgs, releaseTagMessage, type CutReleasePort } from '../cutRelease.ts';
import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import {
    CHANGELOG_PREAMBLE,
    composeChangelogEntry,
    parseSemanticVersion,
    releaseCommitSubject,
    upsertChangelogEntry,
    type MergedPullRequest,
} from '../releaseVersion.ts';

const commit = 'a'.repeat(40);
const tagObjectSha = 'b'.repeat(40);
const range: MergedPullRequest[] = [
    { number: 10, title: 'fix(arrangement): preserve reorder track state' },
    { number: 20, title: 'feat(mixer): add a post-fader send' },
];

function changelogFor(version: string, pullRequests: MergedPullRequest[]): string {
    const semantic = parseSemanticVersion(version, 'fixture version');
    return upsertChangelogEntry(
        CHANGELOG_PREAMBLE,
        semantic,
        composeChangelogEntry(semantic, '2026-08-28', pullRequests),
        []
    );
}

type Overrides = {
    tagNames?: string[];
    releasedTagNames?: string[];
    latestReleaseTag?: string | undefined;
    onMain?: boolean;
    manifestVersion?: string;
    changelog?: string;
    range?: MergedPullRequest[];
    tagObjectSha?: string;
    refSha?: string;
    refName?: string;
    releaseTagName?: string;
    releaseTarget?: string;
    draft?: boolean;
    releaseId?: number;
};

function fakePort(overrides: Overrides = {}): CutReleasePort & { calls: string[]; notes: string[] } {
    const calls: string[] = [];
    const notes: string[] = [];
    return {
        calls,
        notes,
        tagNames: () => overrides.tagNames ?? ['v0.1.0', 'v0.2.0'],
        releasedTagNames: () => overrides.releasedTagNames ?? ['v0.1.0', 'v0.2.0'],
        latestReleaseTag: () => ('latestReleaseTag' in overrides ? overrides.latestReleaseTag : 'v0.2.0'),
        commitIsOnMain: () => overrides.onMain ?? true,
        manifestVersionAt: () => overrides.manifestVersion ?? '0.3.0',
        changelogAt: () => overrides.changelog ?? changelogFor('0.3.0', range),
        mergedPullRequests: () => overrides.range ?? range,
        createTag: (tag, target, message) => {
            calls.push(`createTag:${tag}:${target}:${message}`);
            return {
                tagObjectSha: overrides.tagObjectSha ?? tagObjectSha,
                refSha: overrides.refSha ?? overrides.tagObjectSha ?? tagObjectSha,
                refName: overrides.refName ?? `refs/tags/${tag}`,
            };
        },
        createRelease: (tag, target, body) => {
            calls.push(`createRelease:${tag}:${target}`);
            notes.push(body);
            return {
                id: overrides.releaseId ?? 1,
                tagName: overrides.releaseTagName ?? tag,
                targetCommitish: overrides.releaseTarget ?? target,
                draft: overrides.draft ?? false,
            };
        },
        log: (message) => calls.push(`log:${message}`),
    };
}

const cut = (port: CutReleasePort, version = '0.3.0') => cutRelease(version, commit, AUTHOR_BOT_NODE_ID, port);

describe('release:cut arguments', () => {
    it('takes a plain version and a full commit sha', () => {
        expect(parseCutReleaseArgs(['0.3.0', '--commit', commit])).toEqual({
            version: '0.3.0',
            commit,
            help: false,
        });
    });

    it('refuses a short sha, a missing flag, a tag-shaped version, and extra arguments', () => {
        expect(() => parseCutReleaseArgs(['0.3.0', '--commit', 'abc'])).toThrow('usage: pnpm release:cut');
        expect(() => parseCutReleaseArgs(['0.3.0', commit])).toThrow('usage: pnpm release:cut');
        expect(() => parseCutReleaseArgs(['v0.3.0', '--commit', commit])).toThrow('usage: pnpm release:cut');
        expect(() => parseCutReleaseArgs(['0.3.0', '--commit', commit, '--force'])).toThrow('usage: pnpm release:cut');
        expect(() => parseCutReleaseArgs(['--help', '0.3.0'])).toThrow('--help takes no other arguments');
    });
});

describe('cutting a release', () => {
    it('creates the tag on the merge revision, then one release bound to it', () => {
        const port = fakePort();
        expect(cut(port)).toBe(`release-cut:v0.3.0:${commit}`);
        expect(port.calls).toEqual([
            `createTag:v0.3.0:${commit}:${releaseTagMessage('v0.3.0')}`,
            `createRelease:v0.3.0:${commit}`,
            `log:release-cut:v0.3.0:${commit}`,
        ]);
    });

    it('publishes the notes the tag range produces', () => {
        const port = fakePort();
        cut(port);
        expect(port.notes).toEqual([
            [
                '### Features',
                '',
                '- feat(mixer): add a post-fader send (#20)',
                '',
                '### Fixes',
                '',
                '- fix(arrangement): preserve reorder track state (#10)',
            ].join('\n'),
        ]);
    });

    it('drops the release pull request its own merge added to the range', () => {
        const port = fakePort({
            range: [...range, { number: 21, title: releaseCommitSubject('0.3.0') }],
        });
        expect(cut(port)).toBe(`release-cut:v0.3.0:${commit}`);
        expect(port.notes[0]).not.toContain(releaseCommitSubject('0.3.0'));
        expect(port.notes[0]).not.toContain('(#21)');
    });

    it('cuts the first release of a repository that carries no release tag yet', () => {
        const port = fakePort({ tagNames: [], releasedTagNames: [], latestReleaseTag: undefined });
        expect(cut(port)).toBe(`release-cut:v0.3.0:${commit}`);
    });
});

describe('cut refusals', () => {
    it('refuses an actor that is not the author bot', () => {
        expect(() => cutRelease('0.3.0', commit, REVIEWER_BOT_NODE_ID, fakePort())).toThrow(
            `is not ${AUTHOR_BOT_NODE_ID}`
        );
    });

    it('refuses a tag that already exists', () => {
        const port = fakePort({ tagNames: ['v0.2.0', 'v0.3.0'] });
        expect(() => cut(port)).toThrow('tag v0.3.0 already exists');
        expect(port.calls).toEqual([]);
    });

    it('refuses a version that already carries a GitHub Release', () => {
        const port = fakePort({ releasedTagNames: ['v0.3.0'] });
        expect(() => cut(port)).toThrow('a GitHub Release for v0.3.0 already exists');
        expect(port.calls).toEqual([]);
    });

    it('refuses a commit that is not on main', () => {
        const port = fakePort({ onMain: false });
        expect(() => cut(port)).toThrow(`${commit} is not on main`);
        expect(port.calls).toEqual([]);
    });

    it('refuses a commit whose package.json is a different version', () => {
        const port = fakePort({ manifestVersion: '0.2.9' });
        expect(() => cut(port)).toThrow(`package.json at ${commit} is 0.2.9, not 0.3.0`);
        expect(port.calls).toEqual([]);
    });

    it('refuses a version that does not advance the latest release tag', () => {
        expect(() => cut(fakePort({ latestReleaseTag: 'v0.4.0', manifestVersion: '0.3.0' }))).toThrow(
            'does not advance the latest release tag v0.4.0'
        );
    });

    it('refuses when the committed changelog does not record the version being cut', () => {
        const port = fakePort({ changelog: changelogFor('0.2.0', range) });
        expect(() => cut(port)).toThrow('records no v0.3.0 entry');
        expect(port.calls).toEqual([]);
    });

    it('refuses when the committed changelog disagrees with the notes for the range', () => {
        const port = fakePort({ changelog: changelogFor('0.3.0', [range[0] as MergedPullRequest]) });
        expect(() => cut(port)).toThrow('does not match the notes for the v0.3.0 range');
        expect(port.calls).toEqual([]);
    });

    it('refuses a tag receipt whose ref does not point at the tag object it just created', () => {
        expect(() => cut(fakePort({ refSha: 'c'.repeat(40) }))).toThrow('creating tag v0.3.0 returned an invalid');
        expect(() => cut(fakePort({ refName: 'refs/heads/v0.3.0' }))).toThrow(
            'creating tag v0.3.0 returned an invalid'
        );
    });

    it('refuses a release that came back as a draft, under another tag, or off the merge revision', () => {
        expect(() => cut(fakePort({ draft: true }))).toThrow('was created as a draft');
        expect(() => cut(fakePort({ releaseTagName: 'v0.3.1' }))).toThrow(
            'creating the GitHub Release for v0.3.0 returned an invalid result'
        );
        expect(() => cut(fakePort({ releaseTarget: 'd'.repeat(40) }))).toThrow('is not bound to');
    });

    it('refuses a range that produced no merged pull request', () => {
        expect(() => cut(fakePort({ range: [] }))).toThrow('at least one merged pull request');
    });
});
