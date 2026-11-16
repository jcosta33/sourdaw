import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { licenceInputDigest } from '../dependencyLicenseInputProjection.ts';
import { DEPENDENCY_LICENSE_PROOFS_PATH } from '../dependencyLicenseReport.ts';
import { proposeRelease, type ProposeReleasePort } from '../proposeRelease.ts';
import {
    CHANGELOG_PATH,
    CHANGELOG_PREAMBLE,
    RELEASE_INVENTORY_PATH,
    packageVersion,
    releaseCommitSubject,
} from '../releaseVersion.ts';

import type { MergedPullRequest } from '../releaseVersion.ts';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const repositoryFile = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

const manifest = (version: string) => `{
    "name": "sourdaw",
    "private": true,
    "version": "${version}",
    "license": "Apache-2.0"
}
`;

type PinnedInput = { path: string; projection?: string; sha256: string };

function pinnedPackageJson(entries: readonly PinnedInput[]): PinnedInput | undefined {
    return entries.find(({ path }) => path === 'package.json');
}

const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

const range: MergedPullRequest[] = [
    { number: 10, title: 'fix(arrangement): preserve reorder track state' },
    { number: 20, title: 'feat(mixer): add a post-fader send' },
];

type Overrides = {
    releaseTags?: string[];
    versionAtBase?: string;
    range?: MergedPullRequest[] | (() => MergedPullRequest[]);
    files?: Record<string, string>;
};

function fakePort(overrides: Overrides = {}): ProposeReleasePort & {
    files: Record<string, string>;
    messages: string[];
} {
    const files: Record<string, string> = {
        'package.json': manifest(overrides.versionAtBase ?? '0.1.0'),
        [CHANGELOG_PATH]: CHANGELOG_PREAMBLE,
        ...overrides.files,
    };
    const messages: string[] = [];
    return {
        files,
        messages,
        releaseTags: () => overrides.releaseTags ?? [],
        versionAtBase: () => overrides.versionAtBase ?? '0.1.0',
        mergedPullRequests: () =>
            typeof overrides.range === 'function' ? overrides.range() : (overrides.range ?? range),
        readWorkspaceFile: (path) => files[path] ?? '',
        writeWorkspaceFile: (path, contents) => {
            files[path] = contents;
        },
        today: () => '2026-08-28',
        log: (message) => messages.push(message),
    };
}

describe('proposing a release', () => {
    it('baselines the first release on the manifest version when no release tag exists', () => {
        const port = fakePort();
        expect(proposeRelease(port)).toEqual({
            version: '0.2.0',
            tag: 'v0.2.0',
            increment: 'minor',
            commitSubject: 'chore(release): 0.2.0',
        });
        expect(packageVersion(port.files['package.json'] ?? '')).toBe('0.2.0');
    });

    it('baselines a later release on the latest release tag', () => {
        const port = fakePort({
            releaseTags: ['v0.3.0', 'v0.4.2'],
            versionAtBase: '0.4.2',
            range: [{ number: 30, title: 'fix(engine): stop drift' }],
        });
        expect(proposeRelease(port)?.version).toBe('0.4.3');
    });

    it('writes the changelog entry the range produces under the preamble', () => {
        const port = fakePort();
        proposeRelease(port);
        expect(port.files[CHANGELOG_PATH]).toBe(
            `${CHANGELOG_PREAMBLE}\n${[
                '## v0.2.0 - 2026-08-28',
                '',
                '### Features',
                '',
                '- feat(mixer): add a post-fader send (#20)',
                '',
                '### Fixes',
                '',
                '- fix(arrangement): preserve reorder track state (#10)',
                '',
            ].join('\n')}`
        );
    });

    it('bumps the real manifest without moving any pin the release gates hold on it', () => {
        const pinned = {
            'package.json': repositoryFile('package.json'),
            [DEPENDENCY_LICENSE_PROOFS_PATH]: repositoryFile(DEPENDENCY_LICENSE_PROOFS_PATH),
            [RELEASE_INVENTORY_PATH]: repositoryFile(RELEASE_INVENTORY_PATH),
        };
        const baseVersion = packageVersion(pinned['package.json']);
        const port = fakePort({ versionAtBase: baseVersion, files: pinned });

        const proposal = proposeRelease(port);

        expect(proposal?.version).not.toBe(baseVersion);
        const bumped = port.files['package.json'] ?? '';
        expect(packageVersion(bumped)).toBe(proposal?.version);
        expect(port.files[DEPENDENCY_LICENSE_PROOFS_PATH]).toBe(pinned[DEPENDENCY_LICENSE_PROOFS_PATH]);
        expect(port.files[RELEASE_INVENTORY_PATH]).toBe(pinned[RELEASE_INVENTORY_PATH]);
        const live = { path: 'package.json', ...licenceInputDigest('package.json', Buffer.from(bumped, 'utf8')) };
        const proofs = JSON.parse(pinned[DEPENDENCY_LICENSE_PROOFS_PATH]) as {
            cargoRuntimeInventory: { sourceInputs: PinnedInput[] };
        };
        const inventory = JSON.parse(pinned[RELEASE_INVENTORY_PATH]) as { snapshots: PinnedInput[] };
        expect(pinnedPackageJson(proofs.cargoRuntimeInventory.sourceInputs)).toEqual(live);
        expect(pinnedPackageJson(inventory.snapshots)).toEqual(live);
    });

    it('names the conventional commit the release lane needs', () => {
        const port = fakePort();
        proposeRelease(port);
        expect(port.messages.at(-1)).toBe('release-proposed:v0.2.0');
        expect(port.messages.some((message) => message.includes(releaseCommitSubject('0.2.0')))).toBe(true);
    });

    it('converges on one entry and one bump when the same range is proposed twice', () => {
        const port = fakePort();
        proposeRelease(port);
        const afterFirst = { ...port.files };
        proposeRelease(port);
        expect(port.files).toEqual(afterFirst);
    });

    it('replaces the stale proposal when a second run computes a different version', () => {
        const fixOnly = [range[0] as MergedPullRequest];
        const ranges = [fixOnly, range];
        const port = fakePort({ range: () => ranges.shift() ?? range });
        expect(proposeRelease(port)?.version).toBe('0.1.1');
        expect(proposeRelease(port)?.version).toBe('0.2.0');
        const changelog = port.files[CHANGELOG_PATH] ?? '';
        expect(changelog).not.toContain('## v0.1.1');
        expect(occurrences(changelog, '## v')).toBe(1);
        expect(occurrences(changelog, '(#10)')).toBe(1);
        expect(occurrences(changelog, '(#20)')).toBe(1);
        expect(packageVersion(port.files['package.json'] ?? '')).toBe('0.2.0');
    });

    it('proposes nothing and writes nothing when no merged change asks for a version', () => {
        const port = fakePort({
            range: [
                { number: 30, title: 'chore(deps): bump a dev tool' },
                { number: 31, title: 'docs: reword a runbook' },
            ],
        });
        const before = { ...port.files };
        expect(proposeRelease(port)).toBeUndefined();
        expect(port.files).toEqual(before);
        expect(port.messages).toEqual([
            'no-release-proposed: nothing merged since the start of history requires a version',
        ]);
    });

    it('accepts a base whose release pull request merged but was never tagged', () => {
        const port = fakePort({
            releaseTags: ['v0.2.0'],
            versionAtBase: '0.3.0',
            range: [
                { number: 10, title: 'fix(arrangement): preserve reorder track state' },
                { number: 40, title: releaseCommitSubject('0.3.0') },
                { number: 50, title: 'feat(mixer): add a post-fader send' },
            ],
        });
        expect(proposeRelease(port)?.version).toBe('0.3.0');
        expect(occurrences(port.files[CHANGELOG_PATH] ?? '', `(#40)`)).toBe(1);
    });

    it('refuses a base whose manifest sits below the latest release tag', () => {
        expect(() => proposeRelease(fakePort({ releaseTags: ['v0.4.2'], versionAtBase: '0.3.0' }))).toThrow(
            'package.json on the release base is 0.3.0 but the latest release tag is v0.4.2'
        );
    });
});
