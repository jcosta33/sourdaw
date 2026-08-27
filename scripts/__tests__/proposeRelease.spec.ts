import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { DEPENDENCY_LICENSE_PROOFS_PATH } from '../dependencyLicenseReport.ts';
import { proposeRelease, releaseCommitSubject, type ProposeReleasePort } from '../proposeRelease.ts';
import { CHANGELOG_PATH, CHANGELOG_PREAMBLE, RELEASE_INVENTORY_PATH, packageVersion } from '../releaseVersion.ts';

import type { MergedPullRequest } from '../releaseVersion.ts';

const manifest = (version: string) => `{
    "name": "sourdaw",
    "private": true,
    "version": "${version}",
    "license": "Apache-2.0"
}
`;

const proofs = (manifestDigest: string) => `{
    "cargoRuntimeInventory": {
        "sourceInputs": [
            {
                "path": "package.json",
                "sha256": "${manifestDigest}"
            }
        ]
    }
}
`;

const inventory = (manifestDigest: string, proofsDigest: string) => `{
    "surfaces": [
        {
            "digests": ["sha256:${proofsDigest}:${DEPENDENCY_LICENSE_PROOFS_PATH}"]
        }
    ],
    "snapshots": [
        {
            "path": "package.json",
            "sha256": "${manifestDigest}"
        }
    ]
}
`;

const range: MergedPullRequest[] = [
    { number: 10, title: 'fix(arrangement): preserve reorder track state' },
    { number: 20, title: 'feat(mixer): add a post-fader send' },
];

type Overrides = {
    previousTag?: string | undefined;
    versionAtBase?: string;
    range?: MergedPullRequest[];
    files?: Record<string, string>;
};

function fakePort(overrides: Overrides = {}): ProposeReleasePort & {
    files: Record<string, string>;
    messages: string[];
} {
    const files: Record<string, string> = {
        'package.json': manifest(overrides.versionAtBase ?? '0.1.0'),
        [CHANGELOG_PATH]: CHANGELOG_PREAMBLE,
        [RELEASE_INVENTORY_PATH]: inventory('0'.repeat(64), '1'.repeat(64)),
        [DEPENDENCY_LICENSE_PROOFS_PATH]: proofs('0'.repeat(64)),
        ...overrides.files,
    };
    const messages: string[] = [];
    return {
        files,
        messages,
        latestReleaseTag: () => ('previousTag' in overrides ? overrides.previousTag : undefined),
        versionAtBase: () => overrides.versionAtBase ?? '0.1.0',
        mergedPullRequests: () => overrides.range ?? range,
        readWorkspaceFile: (path) => files[path] ?? '',
        writeWorkspaceFile: (path, contents) => {
            files[path] = contents;
        },
        digest: (contents) => createHash('sha256').update(contents, 'utf8').digest('hex'),
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
            previousTag: 'v0.4.2',
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

    it('moves the whole pinned-digest chain with the manifest it bumped', () => {
        const port = fakePort();
        proposeRelease(port);
        const sha256 = (contents: string) => createHash('sha256').update(contents, 'utf8').digest('hex');
        const expectedProofs = proofs(sha256(port.files['package.json'] ?? ''));
        expect(port.files[DEPENDENCY_LICENSE_PROOFS_PATH]).toBe(expectedProofs);
        expect(port.files[RELEASE_INVENTORY_PATH]).toBe(
            inventory(sha256(port.files['package.json'] ?? ''), sha256(expectedProofs))
        );
    });

    it('names the conventional commit the release lane needs', () => {
        const port = fakePort();
        proposeRelease(port);
        expect(port.messages.at(-1)).toBe('release-proposed:v0.2.0');
        expect(port.messages.some((message) => message.includes(releaseCommitSubject('0.2.0')))).toBe(true);
    });

    it('converges on one entry and one bump when it runs twice in the same lane', () => {
        const port = fakePort();
        proposeRelease(port);
        const afterFirst = { ...port.files };
        proposeRelease(port);
        expect(port.files).toEqual(afterFirst);
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

    it('refuses a base whose manifest disagrees with the latest release tag', () => {
        expect(() => proposeRelease(fakePort({ previousTag: 'v0.4.2', versionAtBase: '0.3.0' }))).toThrow(
            'package.json on the release base is 0.3.0 but the latest release tag is v0.4.2'
        );
    });
});
