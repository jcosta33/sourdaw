import { describe, expect, it } from 'vitest';

import { TITLE_PATTERN } from '../prContract.ts';
import {
    CHANGELOG_PREAMBLE,
    CONVENTIONAL_TYPES,
    RELEASE_BODY_CHARACTER_LIMIT,
    aggregateIncrement,
    changelogSectionBody,
    composeChangelogEntry,
    composeReleaseNotes,
    formatSemanticVersion,
    latestReleaseTagOf,
    nextVersion,
    packageVersion,
    parseConventionalTitle,
    parseReleaseTagName,
    parseSemanticVersion,
    releaseBody,
    releaseCommitSubject,
    releaseTagName,
    squashedPullRequestNumbers,
    titleIncrement,
    upsertChangelogEntry,
    withPackageVersion,
    withPathAddressedDigest,
    withSnapshotDigest,
    withoutPullRequest,
    type MergedPullRequest,
} from '../releaseVersion.ts';

const version = (value: string) => parseSemanticVersion(value, 'test version');
const bump = (base: string, titles: string[]) => {
    const next = nextVersion(
        version(base),
        aggregateIncrement(titles.map((title, index) => ({ number: index + 1, title })))
    );
    return next === undefined ? undefined : formatSemanticVersion(next);
};

const manifest = `{
    "name": "sourdaw",
    "private": true,
    "version": "0.1.0",
    "license": "Apache-2.0"
}
`;

const inventory = `{
    "snapshots": [
        {
            "path": "package.json",
            "sha256": "${'a'.repeat(64)}"
        },
        {
            "path": "server/package.json",
            "sha256": "${'b'.repeat(64)}"
        }
    ]
}
`;

describe('conventional title parsing', () => {
    it('classifies every conventional type the delivery title contract accepts', () => {
        for (const type of CONVENTIONAL_TYPES) {
            expect(TITLE_PATTERN.test(`${type}(scope): subject`)).toBe(true);
            expect(parseConventionalTitle(`${type}(scope): subject`)?.type).toBe(type);
        }
    });

    it('reads the scope, the breaking mark, and the description apart', () => {
        expect(parseConventionalTitle('feat(arrangement)!: split clips at the playhead')).toEqual({
            type: 'feat',
            scope: 'arrangement',
            breaking: true,
            description: 'split clips at the playhead',
        });
        expect(parseConventionalTitle('fix: preserve reorder track state')).toEqual({
            type: 'fix',
            scope: undefined,
            breaking: false,
            description: 'preserve reorder track state',
        });
    });

    it('refuses a title whose type is not a conventional type', () => {
        expect(parseConventionalTitle('wip(arrangement): something')).toBeUndefined();
        expect(parseConventionalTitle('no conventional prefix here')).toBeUndefined();
        expect(titleIncrement('wip!: something drastic')).toBe('none');
    });
});

describe('semantic increment', () => {
    it('takes a patch from a fix and from a performance change', () => {
        expect(titleIncrement('fix(transport): stop drift')).toBe('patch');
        expect(titleIncrement('perf(engine): halve the scheduling cost')).toBe('patch');
    });

    it('takes a minor from a feature and a major from a breaking mark on any type', () => {
        expect(titleIncrement('feat(mixer): add a send')).toBe('minor');
        expect(titleIncrement('fix(mixer)!: drop the legacy send format')).toBe('major');
        expect(titleIncrement('refactor!: rename the project file extension')).toBe('major');
    });

    it('takes no increment from housekeeping types', () => {
        for (const title of ['chore: bump a dev tool', 'docs: reword a runbook', 'ci: retune a gate']) {
            expect(titleIncrement(title)).toBe('none');
        }
    });

    it('takes the strongest increment across a mixed range', () => {
        expect(
            aggregateIncrement([
                { number: 1, title: 'fix: a' },
                { number: 2, title: 'feat: b' },
                { number: 3, title: 'chore: c' },
            ])
        ).toBe('minor');
        expect(
            aggregateIncrement([
                { number: 1, title: 'fix: a' },
                { number: 2, title: 'feat!: b' },
            ])
        ).toBe('major');
    });
});

describe('pre-1.0 version policy', () => {
    it('keeps a zero major and moves the minor for a feature or a breaking change', () => {
        expect(bump('0.1.0', ['feat: a'])).toBe('0.2.0');
        expect(bump('0.1.4', ['feat!: a'])).toBe('0.2.0');
        expect(bump('0.1.4', ['refactor!: a'])).toBe('0.2.0');
    });

    it('moves only the patch for a fix', () => {
        expect(bump('0.1.4', ['fix: a', 'chore: b'])).toBe('0.1.5');
    });

    it('proposes no version when nothing merged asks for one', () => {
        expect(bump('0.1.0', ['chore: a', 'docs: b', 'test: c'])).toBeUndefined();
        expect(bump('0.1.0', [])).toBeUndefined();
    });

    it('applies the standard mapping once the line is past 1.0', () => {
        expect(bump('1.4.2', ['feat!: a'])).toBe('2.0.0');
        expect(bump('1.4.2', ['feat: a'])).toBe('1.5.0');
        expect(bump('1.4.2', ['fix: a'])).toBe('1.4.3');
    });
});

describe('release tags', () => {
    it('round-trips a version through its tag', () => {
        expect(releaseTagName(version('1.2.3'))).toBe('v1.2.3');
        expect(parseReleaseTagName('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it('ignores tags that are not release tags and orders the rest by version', () => {
        expect(parseReleaseTagName('evidence/grand-boule-benchmark-2026-08-22')).toBeUndefined();
        expect(parseReleaseTagName('v1.2')).toBeUndefined();
        expect(latestReleaseTagOf(['v0.9.0', 'evidence/thing', 'v0.10.0', 'v0.2.0'])).toBe('v0.10.0');
        expect(latestReleaseTagOf(['evidence/thing'])).toBeUndefined();
    });
});

describe('release notes', () => {
    const range: MergedPullRequest[] = [
        { number: 30, title: 'chore(deps): bump a dev tool' },
        { number: 10, title: 'fix(arrangement): preserve reorder track state' },
        { number: 20, title: 'feat(mixer): add a post-fader send' },
        { number: 40, title: 'perf(engine): halve the scheduling cost' },
        { number: 50, title: 'feat(project)!: drop the legacy project format' },
        { number: 60, title: 'an off-convention title' },
    ];

    it('categorizes by type with breaking changes first and passes titles through unchanged', () => {
        expect(composeReleaseNotes(range)).toBe(
            [
                '### Breaking changes',
                '',
                '- feat(project)!: drop the legacy project format (#50)',
                '',
                '### Features',
                '',
                '- feat(mixer): add a post-fader send (#20)',
                '',
                '### Fixes',
                '',
                '- fix(arrangement): preserve reorder track state (#10)',
                '',
                '### Performance',
                '',
                '- perf(engine): halve the scheduling cost (#40)',
                '',
                '### Other changes',
                '',
                '- chore(deps): bump a dev tool (#30)',
                '- an off-convention title (#60)',
            ].join('\n')
        );
    });

    it('writes only the headings its range populates', () => {
        expect(composeReleaseNotes([{ number: 7, title: 'fix: only a fix' }])).toBe(
            '### Fixes\n\n- fix: only a fix (#7)'
        );
    });

    it('refuses a range with no merged pull request, a repeated number, or a title that is not one line', () => {
        expect(() => composeReleaseNotes([])).toThrow('at least one merged pull request');
        expect(() =>
            composeReleaseNotes([
                { number: 7, title: 'fix: a' },
                { number: 7, title: 'fix: b' },
            ])
        ).toThrow('repeat pull request #7');
        expect(() => composeReleaseNotes([{ number: 7, title: 'fix: a\nfix: b' }])).toThrow('must be one line');
        expect(() => composeReleaseNotes([{ number: 7, title: '   ' }])).toThrow('empty title');
    });
});

describe('release body', () => {
    const longRange = Array.from({ length: 4000 }, (_, index) => ({
        number: index + 1,
        title: `fix(scope): a subject long enough to matter for the ceiling ${String(index)}`,
    }));

    it('publishes the notes unchanged when GitHub can hold them', () => {
        const notes = composeReleaseNotes([{ number: 7, title: 'fix: a' }]);
        expect(releaseBody(notes, 'v0.2.0')).toBe(notes);
    });

    it('cuts an oversized range at an entry boundary and points at the committed changelog', () => {
        const notes = composeReleaseNotes(longRange);
        expect(notes.length).toBeGreaterThan(RELEASE_BODY_CHARACTER_LIMIT);
        const body = releaseBody(notes, 'v0.2.0');
        expect(body.length).toBeLessThanOrEqual(RELEASE_BODY_CHARACTER_LIMIT);
        expect(body).toContain('CHANGELOG.md at v0.2.0 carries every entry');
        const entries = body.split('\n').filter((line) => line.startsWith('- '));
        expect(entries.length).toBeGreaterThan(0);
        expect(notes.split('\n')).toEqual(expect.arrayContaining(entries));
    });
});

describe('changelog', () => {
    const entry = (value: string, date: string, pullRequests: MergedPullRequest[]) =>
        composeChangelogEntry(version(value), date, pullRequests);
    const firstEntry = entry('0.2.0', '2026-08-28', [{ number: 20, title: 'feat(mixer): add a post-fader send' }]);
    const secondEntry = entry('0.3.0', '2026-09-04', [{ number: 40, title: 'feat(engine): add a bus' }]);

    it('heads an entry with its tag and date', () => {
        expect(firstEntry.startsWith('## v0.2.0 - 2026-08-28\n\n')).toBe(true);
        expect(() => entry('0.2.0', '28-08-2026', [{ number: 1, title: 'fix: a' }])).toThrow('not YYYY-MM-DD');
    });

    it('keeps a released entry and puts the new one directly under the preamble', () => {
        const released = upsertChangelogEntry(CHANGELOG_PREAMBLE, version('0.2.0'), firstEntry, []);
        const afterSecond = upsertChangelogEntry(released, version('0.3.0'), secondEntry, ['v0.2.0']);
        expect(afterSecond).toBe(`${CHANGELOG_PREAMBLE}\n${secondEntry}\n${firstEntry}`);
    });

    it('replaces an entry it already recorded rather than stacking a second one', () => {
        const afterFirst = upsertChangelogEntry(CHANGELOG_PREAMBLE, version('0.2.0'), firstEntry, []);
        const revised = entry('0.2.0', '2026-08-29', [
            { number: 20, title: 'feat(mixer): add a post-fader send' },
            { number: 21, title: 'fix(mixer): clamp the send level' },
        ]);
        const afterRevision = upsertChangelogEntry(afterFirst, version('0.2.0'), revised, []);
        expect(afterRevision).toBe(`${CHANGELOG_PREAMBLE}\n${revised}`);
        expect(afterRevision).not.toContain('2026-08-28');
    });

    it('drops an unreleased entry whose version the new proposal no longer matches', () => {
        const stale = upsertChangelogEntry(CHANGELOG_PREAMBLE, version('0.2.0'), firstEntry, []);
        const rebuilt = entry('0.3.0', '2026-09-04', [
            { number: 20, title: 'feat(mixer): add a post-fader send' },
            { number: 40, title: 'feat(engine): add a bus' },
        ]);
        const afterSecond = upsertChangelogEntry(stale, version('0.3.0'), rebuilt, []);
        expect(afterSecond).toBe(`${CHANGELOG_PREAMBLE}\n${rebuilt}`);
        expect(afterSecond).not.toContain('## v0.2.0');
        expect(afterSecond.split('(#20)').length - 1).toBe(1);
    });

    it('drops every unreleased entry above the newest released one', () => {
        const released = upsertChangelogEntry(CHANGELOG_PREAMBLE, version('0.2.0'), firstEntry, []);
        const stale = upsertChangelogEntry(released, version('0.3.0'), secondEntry, ['v0.2.0']);
        const rebuilt = entry('0.4.0', '2026-09-11', [{ number: 40, title: 'feat(engine): add a bus' }]);
        const afterThird = upsertChangelogEntry(stale, version('0.4.0'), rebuilt, ['v0.2.0']);
        expect(afterThird).toBe(`${CHANGELOG_PREAMBLE}\n${rebuilt}\n${firstEntry}`);
        expect(afterThird).not.toContain('## v0.3.0');
    });

    it('refuses to propose a version that is already released', () => {
        expect(() => upsertChangelogEntry(CHANGELOG_PREAMBLE, version('0.2.0'), firstEntry, ['v0.2.0'])).toThrow(
            'v0.2.0 is already released'
        );
    });

    it('scopes a section body to its own tag range', () => {
        const released = upsertChangelogEntry(CHANGELOG_PREAMBLE, version('0.2.0'), firstEntry, []);
        const afterSecond = upsertChangelogEntry(released, version('0.3.0'), secondEntry, ['v0.2.0']);
        expect(changelogSectionBody(afterSecond, version('0.3.0'))).toBe(
            '### Features\n\n- feat(engine): add a bus (#40)'
        );
        expect(changelogSectionBody(afterSecond, version('0.2.0'))).toBe(
            '### Features\n\n- feat(mixer): add a post-fader send (#20)'
        );
        expect(changelogSectionBody(afterSecond, version('0.9.0'))).toBeUndefined();
    });

    it('refuses a changelog that does not start with the preamble, or one carrying a foreign section', () => {
        expect(() => upsertChangelogEntry('# Something else\n', version('0.2.0'), firstEntry, [])).toThrow(
            'does not start with the changelog preamble'
        );
        expect(() =>
            upsertChangelogEntry(`${CHANGELOG_PREAMBLE}\n## Unreleased\n\nnotes\n`, version('0.2.0'), firstEntry, [])
        ).toThrow('is not a version section');
    });
});

describe('manifest and inventory rewrites', () => {
    it('moves only the version field', () => {
        expect(packageVersion(manifest)).toBe('0.1.0');
        const bumped = withPackageVersion(manifest, version('0.2.0'));
        expect(packageVersion(bumped)).toBe('0.2.0');
        expect(bumped).toBe(manifest.replace('"version": "0.1.0"', '"version": "0.2.0"'));
    });

    it('moves only the named snapshot digest', () => {
        const rewritten = withSnapshotDigest(inventory, 'package.json', 'c'.repeat(64));
        expect(rewritten).toBe(inventory.replace('a'.repeat(64), 'c'.repeat(64)));
        expect(rewritten).toContain('b'.repeat(64));
    });

    it('refuses a digest that is not SHA-256 and a path the inventory does not pin', () => {
        expect(() => withSnapshotDigest(inventory, 'package.json', 'not-a-digest')).toThrow('not a SHA-256 digest');
        expect(() => withSnapshotDigest(inventory, 'Cargo.toml', 'c'.repeat(64))).toThrow(
            'does not carry exactly one Cargo.toml snapshot'
        );
    });

    it('moves only the named path-addressed digest', () => {
        const surfaces = `{
    "digests": [
        "sha256:${'a'.repeat(64)}:release/dependency-license-proofs.json",
        "sha256:${'b'.repeat(64)}:release/web-artifact-manifest.json"
    ]
}
`;
        expect(withPathAddressedDigest(surfaces, 'release/dependency-license-proofs.json', 'c'.repeat(64))).toBe(
            surfaces.replace('a'.repeat(64), 'c'.repeat(64))
        );
        expect(() => withPathAddressedDigest(surfaces, 'release/absent.json', 'c'.repeat(64))).toThrow(
            'does not carry exactly one path-addressed digest for release/absent.json'
        );
    });
});

describe('dropping one pull request', () => {
    it('drops by number, keeping a different pull request that carries the same title', () => {
        const entries = [
            { number: 10, title: 'fix(arrangement): preserve reorder track state' },
            { number: 21, title: releaseCommitSubject('0.3.0') },
            { number: 99, title: releaseCommitSubject('0.3.0') },
        ];
        expect(withoutPullRequest(entries, 99)).toEqual([entries[0], entries[1]]);
        expect(withoutPullRequest(entries, 7)).toEqual(entries);
    });
});

describe('squash subjects', () => {
    it('reads the trailing merge reference and ignores a number written mid-title', () => {
        expect(
            squashedPullRequestNumbers([
                'fix(arrangement): preserve reorder track state (#2942)',
                'feat: mention (#123) in prose but land as (#2943)',
                'chore: a subject with no merge reference',
                'fix: duplicate (#2942)',
            ])
        ).toEqual([2942, 2943]);
    });
});
