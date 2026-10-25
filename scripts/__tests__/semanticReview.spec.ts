import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { SEMANTIC_SIDECAR_DIRECTORY, SemanticFailure } from '../semanticReview/contracts.ts';
import { parseNameStatus } from '../semanticReview/gitSource.ts';
import { TYPESAFE_API_KEY_ENV } from '../semanticReview/provider.ts';
import { handlerVerify, parseCommandLine } from '../semanticReview.ts';

describe('command line', () => {
    it('parses a pull-request scan', () => {
        const parsed = parseCommandLine(['scan', '--pr', '42']);
        expect(parsed.command).toBe('scan');
        expect(parsed.pr).toBe(42);
        expect(parsed.profile).toBe('ci');
        expect(parsed.dryRun).toBe(false);
    });

    it('parses a dry run with an explicit local profile', () => {
        const parsed = parseCommandLine([
            'scan',
            '--base',
            'main',
            '--head',
            'HEAD',
            '--profile',
            'local',
            '--dry-run',
        ]);
        expect(parsed.base).toBe('main');
        expect(parsed.head).toBe('HEAD');
        expect(parsed.profile).toBe('local');
        expect(parsed.dryRun).toBe(true);
    });

    it('parses a verification of candidate findings', () => {
        const parsed = parseCommandLine(['verify', '--bundle', '/tmp/bundle', '--findings', '/tmp/findings.json']);
        expect(parsed.command).toBe('verify');
        expect(parsed.bundlePath).toBe('/tmp/bundle');
        expect(parsed.findingsPath).toBe('/tmp/findings.json');
    });

    it('accepts an explicit trusted execution sha for CI runs', () => {
        // In a pull_request_target run origin/main can advance past the checked-out tree, so CI names
        // the revision it actually ran instead of letting the branch tip speak for it.
        const sha = 'a'.repeat(40);
        const parsed = parseCommandLine(['scan', '--pr', '7', '--trusted-sha', sha]);
        expect(parsed.trustedSha).toBe(sha);
    });

    it('leaves the trusted revision unset when the caller does not name one', () => {
        expect(parseCommandLine(['scan', '--pr', '7']).trustedSha).toBeUndefined();
    });

    it('refuses an unknown subcommand', () => {
        expect(() => parseCommandLine(['publish'])).toThrow(/Usage/u);
    });

    it('refuses an unknown option rather than ignoring it', () => {
        expect(() => parseCommandLine(['scan', '--pr', '1', '--force'])).toThrow(/unknown option/u);
    });

    it('refuses a non-positive pull request number', () => {
        expect(() => parseCommandLine(['scan', '--pr', '0'])).toThrow(/positive integer/u);
    });

    it('refuses an unknown profile', () => {
        expect(() => parseCommandLine(['scan', '--pr', '1', '--profile', 'turbo'])).toThrow(/ci or local/u);
    });

    it('refuses an option missing its value', () => {
        expect(() => parseCommandLine(['scan', '--pr'])).toThrow(/requires a value/u);
    });
});

describe('name-status parsing', () => {
    it('reads additions, deletions, and modifications', () => {
        const statuses = parseNameStatus('A\0src/new.ts\0M\0src/changed.ts\0D\0src/gone.ts\0');
        expect(statuses.get('src/new.ts')).toEqual({ kind: 'added' });
        expect(statuses.get('src/changed.ts')).toEqual({ kind: 'modified' });
        expect(statuses.get('src/gone.ts')).toEqual({ kind: 'deleted' });
    });

    it('reads a rename as the new path carrying its previous path', () => {
        // AC-03: a rename is one change with both identities, not an unrelated add plus delete.
        const statuses = parseNameStatus('R100\0src/old.ts\0src/new.ts\0');
        expect(statuses.get('src/new.ts')).toEqual({ kind: 'renamed', previousPath: 'src/old.ts' });
        expect(statuses.has('src/old.ts')).toBe(false);
    });

    it('reads a copy as the new path carrying its source path', () => {
        // A copy has both sides: the source is unchanged and the destination is new. Reporting it as
        // `added` waived the before side, so it must carry its own kind and source path.
        const statuses = parseNameStatus('C100\0src/a.ts\0src/b.ts\0');
        expect(statuses.get('src/b.ts')).toEqual({ kind: 'copied', previousPath: 'src/a.ts' });
        expect(statuses.has('src/a.ts')).toBe(false);
    });

    it('stops cleanly on a truncated record rather than inventing an entry', () => {
        const statuses = parseNameStatus('M\0src/changed.ts\0R100\0src/old.ts\0');
        expect(statuses.size).toBe(1);
    });
});

describe('verify handler', () => {
    it('refuses --export-payload without --dry-run before any run', async () => {
        // The bundle and findings paths do not exist: reaching their reads would fail differently, so
        // this message proves the refusal fires before the run rather than after spending it.
        let failure: unknown;
        try {
            await handlerVerify(
                {
                    command: 'verify',
                    bundlePath: 'unused-bundle',
                    findingsPath: 'unused-findings.json',
                    exportPayloadPath: 'unused-payload.json',
                    profile: 'local',
                    dryRun: false,
                },
                'unused-primary-root'
            );
        } catch (error) {
            failure = error;
        }
        expect(failure).toBeInstanceOf(SemanticFailure);
        expect((failure as SemanticFailure).code).toBe('unsupported_scope');
        expect((failure as SemanticFailure).message).toBe('--export-payload is only supported together with --dry-run');
    });

    it('writes the request previews on a dry run and leaves no report sidecar', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-verify-dry-run-'));
        const git = (args: string[]): string => {
            // Node skips undefined entries when it copies a child environment, so this is the same
            // unset the child would see from a deleted key.
            const env = { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined };
            const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', shell: false });
            if (result.error !== undefined) {
                throw result.error;
            }
            if (result.status !== 0) {
                throw new Error(result.stderr);
            }
            return result.stdout.trim();
        };
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const key = process.env[TYPESAFE_API_KEY_ENV];
        delete process.env[TYPESAFE_API_KEY_ENV];
        try {
            git(['init', '-b', 'main']);
            git(['config', 'user.name', 'Fixture']);
            git(['config', 'user.email', 'fixture@example.com']);
            const file = join(root, 'src/modules/Project/a.ts');
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, 'first line\nsecond line\n');
            git(['add', 'src/modules/Project/a.ts']);
            git(['commit', '--no-gpg-sign', '-m', 'base']);
            const baseSha = git(['rev-parse', 'HEAD']);
            writeFileSync(file, 'first line\nsecond line changed\n');
            git(['add', 'src/modules/Project/a.ts']);
            git(['commit', '--no-gpg-sign', '-m', 'head']);
            const headSha = git(['rev-parse', 'HEAD']);
            git(['remote', 'add', 'origin', 'https://github.com/jcosta33/sourdaw.git']);

            const bundle = join(root, 'bundle');
            mkdirSync(bundle, { recursive: true });
            writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ headSha, baseSha }));
            const findingsPath = join(root, 'findings.json');
            writeFileSync(
                findingsPath,
                JSON.stringify([
                    {
                        findingId: 'f1',
                        headSha,
                        claim: 'a claim',
                        expectedBehavior: 'an expected behavior',
                        evidenceReferences: [
                            { path: 'src/modules/Project/a.ts', side: 'after', startLine: 2, endLine: 2 },
                        ],
                    },
                    {
                        // Names only the sensitive-path screen's own file, so no request can ever
                        // carry its evidence and a live run would send nothing for it.
                        findingId: 'f2',
                        headSha,
                        claim: 'a withheld claim',
                        expectedBehavior: 'another expected behavior',
                        evidenceReferences: [{ path: '.env', side: 'after', startLine: 1, endLine: 1 }],
                    },
                ])
            );
            const exportPath = join(root, 'payload.json');

            // The key is unset, so a handler that loaded the live provider port would refuse on the
            // missing credential instead of completing: exit 0 is the proof the stub was applied.
            const exit = await handlerVerify(
                {
                    command: 'verify',
                    bundlePath: bundle,
                    findingsPath,
                    exportPayloadPath: exportPath,
                    profile: 'local',
                    dryRun: true,
                    trustedSha: headSha,
                },
                root
            );
            expect(exit).toBe(0);
            const previews = JSON.parse(readFileSync(exportPath, 'utf8')) as unknown;
            expect(Array.isArray(previews)).toBe(true);
            const preview = (previews as { findingId?: string; state?: unknown; omissionReason?: string }[])[0];
            expect(preview?.findingId).toBe('f1');
            expect(preview?.omissionReason).toBeUndefined();
            expect(JSON.stringify(preview?.state)).toContain('second line changed');
            // The withheld finding still exports its (empty) request, but the summary counts only
            // what a live run would send and names the withheld finding separately.
            const withheldPreview = (previews as { findingId?: string; omissionReason?: string }[])[1];
            expect(withheldPreview?.findingId).toBe('f2');
            expect(withheldPreview?.omissionReason).toBe('no-admissible-evidence');
            // A dry run produced no report to validate or write.
            expect(existsSync(join(root, '.agents', SEMANTIC_SIDECAR_DIRECTORY))).toBe(false);
            expect(logSpy.mock.calls).toContainEqual([
                'dry-run: 1 request(s) would be sent; no TypeSafe call was made',
            ]);
            expect(logSpy.mock.calls).toContainEqual([
                'dry-run: 1 finding(s) would send no request; every region they named was withheld',
            ]);
        } finally {
            if (key !== undefined) {
                process.env[TYPESAFE_API_KEY_ENV] = key;
            }
            logSpy.mockRestore();
            warnSpy.mockRestore();
            rmSync(root, { recursive: true, force: true });
        }
    });
});
