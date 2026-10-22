import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const HELPER = resolve('scripts/aptWithoutMicrosoftFeed.sh');
const APT_CONFIG_STUB = resolve('scripts/__tests__/fixtures/aptConfigStub');

// The hosted Ubuntu 24.04 image's configuration: the deb822 Ubuntu archive
// behind the runner's mirror list, the Microsoft product feed its
// packages-microsoft-prod.deb installs, and unrelated third-party sources.
const UBUNTU_SOURCES = [
    'Types: deb',
    'URIs: mirror+file:/etc/apt/apt-mirrors.txt',
    'Suites: noble noble-updates noble-backports',
    'Components: main restricted universe multiverse',
    'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg',
    '',
    'Types: deb',
    'URIs: http://security.ubuntu.com/ubuntu/',
    'Suites: noble-security',
    'Components: main restricted universe multiverse',
    'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg',
    '',
].join('\n');
const MICROSOFT_FEED_LIST =
    'deb [arch=amd64,arm64,armhf signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/ubuntu/24.04/prod noble main\n';
const MICROSOFT_FEED_SOURCES = [
    'Types: deb',
    'URIs: https://packages.microsoft.com/ubuntu/24.04/prod',
    'Suites: noble',
    'Components: main',
    'Architectures: amd64 arm64 armhf',
    'Signed-By: /usr/share/keyrings/microsoft-prod.gpg',
    '',
].join('\n');
const OTHER_MICROSOFT_REPOSITORY =
    'deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ noble main\n';
const THIRD_PARTY_LIST =
    'deb [signed-by=/etc/apt/keyrings/git-lfs.gpg] https://packagecloud.io/github/git-lfs/ubuntu/ noble main\n';
const COMMENTED_MAIN_LIST =
    '# Ubuntu sources have moved to /etc/apt/sources.list.d/ubuntu.sources\n# deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n';

type Fixture = { root: string; etc: string; parts: string; seen: string };

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function aptFixture(parts: Record<string, string>, mainList: string | undefined = COMMENTED_MAIN_LIST): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-apt-feed-'));
    roots.push(root);
    const etc = join(root, 'etc');
    const partsDirectory = join(etc, 'sources.list.d');
    mkdirSync(partsDirectory, { recursive: true });
    if (mainList !== undefined) {
        writeFileSync(join(etc, 'sources.list'), mainList);
    }
    for (const [name, contents] of Object.entries(parts)) {
        writeFileSync(join(partsDirectory, name), contents);
    }
    return { root, etc, parts: partsDirectory, seen: join(root, 'seen') };
}

// The command copies whatever source configuration APT_CONFIG hands it, so the
// assertions read exactly what an apt run by the command would read.
const RECORD_EFFECTIVE_SOURCES = [
    'list=$(sed -n \'s/^Dir::Etc::sourcelist "\\(.*\\)";$/\\1/p\' "$APT_CONFIG")',
    'parts=$(sed -n \'s/^Dir::Etc::sourceparts "\\(.*\\)";$/\\1/p\' "$APT_CONFIG")',
    'mkdir -p "$SEEN/sources.list.d"',
    'if [ -e "$list" ]; then cp "$list" "$SEEN/sources.list"; fi',
    'cp -R "$parts/." "$SEEN/sources.list.d/"',
    'exit "$COMMAND_STATUS"',
].join('\n');

function runHelper(fixture: Fixture, options: { commandStatus?: number; aptIgnoresConfig?: boolean } = {}) {
    return spawnSync('bash', [HELPER, 'bash', '-c', RECORD_EFFECTIVE_SOURCES], {
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${APT_CONFIG_STUB}${delimiter}${process.env.PATH ?? ''}`,
            TMPDIR: fixture.root,
            FAKE_APT_SOURCE_LIST: join(fixture.etc, 'sources.list'),
            FAKE_APT_SOURCE_PARTS: fixture.parts,
            FAKE_APT_IGNORES_APT_CONFIG: String(options.aptIgnoresConfig ?? false),
            SEEN: fixture.seen,
            COMMAND_STATUS: String(options.commandStatus ?? 0),
        },
    });
}

function seenParts(fixture: Fixture): Record<string, string> {
    const directory = join(fixture.seen, 'sources.list.d');
    return Object.fromEntries(
        readdirSync(directory)
            .sort()
            .map((name) => [name, readFileSync(join(directory, name), 'utf8')])
    );
}

function leftoverWorkDirectories(fixture: Fixture): string[] {
    return readdirSync(fixture.root).filter((name) => name.startsWith('tmp.'));
}

describe('aptWithoutMicrosoftFeed', () => {
    it.each([
        ['one-line', 'microsoft-prod.list', MICROSOFT_FEED_LIST],
        ['deb822', 'microsoft-prod.sources', MICROSOFT_FEED_SOURCES],
    ])(
        'leaves out only a standalone %s Microsoft product feed and keeps every other source byte for byte',
        (_format, feedFile, feed) => {
            const kept = {
                'azure-cli.list': OTHER_MICROSOFT_REPOSITORY,
                'github_git-lfs.list': THIRD_PARTY_LIST,
                'ubuntu.sources': UBUNTU_SOURCES,
            };
            const fixture = aptFixture({ ...kept, [feedFile]: feed });

            const result = runHelper(fixture);

            expect(result.status, result.stderr).toBe(0);
            expect(seenParts(fixture)).toEqual(kept);
            expect(readFileSync(join(fixture.seen, 'sources.list'), 'utf8')).toBe(COMMENTED_MAIN_LIST);
            expect(result.stderr).toContain(`leaving out ${join(fixture.parts, feedFile)} for this command`);
            expect(leftoverWorkDirectories(fixture)).toEqual([]);
        }
    );

    it('runs the command over the unchanged sources when no Microsoft product feed is configured', () => {
        const kept = { 'github_git-lfs.list': THIRD_PARTY_LIST, 'ubuntu.sources': UBUNTU_SOURCES };
        const fixture = aptFixture(kept, undefined);

        const result = runHelper(fixture);

        expect(result.status, result.stderr).toBe(0);
        expect(seenParts(fixture)).toEqual(kept);
        expect(result.stderr).toBe('');
    });

    it.each([0, 1, 100])('exits with the command status %i', (commandStatus) => {
        const fixture = aptFixture({ 'microsoft-prod.list': MICROSOFT_FEED_LIST, 'ubuntu.sources': UBUNTU_SOURCES });

        expect(runHelper(fixture, { commandStatus }).status).toBe(commandStatus);
        expect(leftoverWorkDirectories(fixture)).toEqual([]);
    });

    it.each([
        ['a one-line file that also lists another source', 'mixed.list', MICROSOFT_FEED_LIST + THIRD_PARTY_LIST],
        ['a deb822 file with another stanza', 'mixed.sources', `${MICROSOFT_FEED_SOURCES}\n${UBUNTU_SOURCES}`],
        [
            'a deb822 stanza naming the feed beside another URI',
            'mixed.sources',
            MICROSOFT_FEED_SOURCES.replace(
                'URIs: https://packages.microsoft.com/ubuntu/24.04/prod',
                'URIs: https://packages.microsoft.com/ubuntu/24.04/prod https://packagecloud.io/github/git-lfs/ubuntu/'
            ),
        ],
    ])('refuses %s without running the command', (_case, name, contents) => {
        const fixture = aptFixture({ [name]: contents, 'ubuntu.sources': UBUNTU_SOURCES });

        const result = runHelper(fixture);

        expect(result.status).toBe(2);
        expect(result.stderr).toContain(
            `${join(fixture.parts, name)} combines the Microsoft product feed with other sources`
        );
        expect(readdirSync(fixture.root)).not.toContain('seen');
    });

    it('refuses when no enabled source signed by the Ubuntu archive key would remain', () => {
        const unsigned = UBUNTU_SOURCES.replaceAll('Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n', '');
        const disabled = UBUNTU_SOURCES.replaceAll('Types: deb\n', 'Types: deb\nEnabled: no\n');
        for (const ubuntu of [unsigned, disabled]) {
            const fixture = aptFixture({ 'microsoft-prod.list': MICROSOFT_FEED_LIST, 'ubuntu.sources': ubuntu });

            const result = runHelper(fixture);

            expect(result.status).toBe(2);
            expect(result.stderr).toContain('no enabled apt source signed by the Ubuntu archive key would remain');
        }
    });

    // apt's StringToBool reads each of these as false, so the stanza is off.
    it.each(['false', 'FALSE', 'off', 'Without', 'disable', '0', '00', '0x0'])(
        'refuses when the only Ubuntu-signed stanzas carry Enabled: %s',
        (spelling) => {
            const disabled = UBUNTU_SOURCES.replaceAll('Types: deb\n', `Types: deb\nEnabled: ${spelling}\n`);
            const fixture = aptFixture({ 'microsoft-prod.list': MICROSOFT_FEED_LIST, 'ubuntu.sources': disabled });

            const result = runHelper(fixture);

            expect(result.status).toBe(2);
            expect(result.stderr).toContain('no enabled apt source signed by the Ubuntu archive key would remain');
        }
    );

    it.each(['yes', 'On', '1', 'unrecognised'])('keeps Ubuntu-signed stanzas carrying Enabled: %s', (spelling) => {
        const enabled = UBUNTU_SOURCES.replaceAll('Types: deb\n', `Types: deb\nEnabled: ${spelling}\n`);
        const fixture = aptFixture({ 'microsoft-prod.list': MICROSOFT_FEED_LIST, 'ubuntu.sources': enabled });

        const result = runHelper(fixture);

        expect(result.status, result.stderr).toBe(0);
        expect(seenParts(fixture)).toEqual({ 'ubuntu.sources': enabled });
    });

    it.runIf(process.getuid?.() !== 0)('refuses an unreadable source file', () => {
        const fixture = aptFixture({ 'microsoft-prod.list': MICROSOFT_FEED_LIST, 'ubuntu.sources': UBUNTU_SOURCES });
        chmodSync(join(fixture.parts, 'ubuntu.sources'), 0o000);

        const result = runHelper(fixture);

        expect(result.status).toBe(2);
        expect(result.stderr).toContain(`cannot read apt source file ${join(fixture.parts, 'ubuntu.sources')}`);
    });

    it('refuses when apt does not read the filtered copy', () => {
        const fixture = aptFixture({ 'microsoft-prod.list': MICROSOFT_FEED_LIST, 'ubuntu.sources': UBUNTU_SOURCES });

        const result = runHelper(fixture, { aptIgnoresConfig: true });

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('apt does not read the filtered sources');
    });
});
