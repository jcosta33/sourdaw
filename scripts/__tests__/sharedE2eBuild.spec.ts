// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSharedE2e, prepareSharedE2e } from '../sharedE2eBuild.ts';

const roots: string[] = [];
const sha = 'a'.repeat(40);
function fixture(): string {
    const root = mkdtempSync(join(tmpdir(), 'shared-e2e-'));
    roots.push(root);
    mkdirSync(join(root, 'public', 'assets'), { recursive: true });
    mkdirSync(join(root, 'dist', 'assets'), { recursive: true });
    writeFileSync(join(root, 'public', 'static.txt'), 'static');
    writeFileSync(join(root, 'public', 'assets', 'collision.js'), 'public');
    writeFileSync(join(root, 'dist', 'assets', 'collision.js'), 'generated');
    writeFileSync(join(root, 'dist', 'index.html'), 'generated index');
    return root;
}
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('shared e2e build', () => {
    it('builds in e2e mode without public copy before writing identity', async () => {
        const root = fixture();
        const build = vi.fn(async () => {
            expect(() => readFileSync(join(root, 'dist', 'shared-e2e-manifest.json'))).toThrow();
        });
        await buildSharedE2e(root, sha, build);
        expect(build).toHaveBeenCalledWith({ root, mode: 'e2e', build: { copyPublicDir: false } });
        expect(JSON.parse(readFileSync(join(root, 'dist', 'shared-e2e-manifest.json'), 'utf8'))).toEqual({
            sha,
            mode: 'e2e',
        });
    });

    it('restores public assets while generated output wins collisions', async () => {
        const root = fixture();
        await buildSharedE2e(root, sha, async () => {});
        await prepareSharedE2e(root, sha);
        expect(readFileSync(join(root, 'dist', 'static.txt'), 'utf8')).toBe('static');
        expect(readFileSync(join(root, 'dist', 'assets', 'collision.js'), 'utf8')).toBe('generated');
        expect(readFileSync(join(root, 'dist', 'index.html'), 'utf8')).toBe('generated index');
    });

    it.each(['missing', 'malformed', 'wrong sha', 'wrong mode', 'missing index'])(
        'rejects %s before copying',
        async (failure) => {
            const root = fixture();
            const manifest = join(root, 'dist', 'shared-e2e-manifest.json');
            if (failure !== 'missing')
                writeFileSync(
                    manifest,
                    failure === 'malformed'
                        ? '{'
                        : JSON.stringify({
                              sha: failure === 'wrong sha' ? 'b'.repeat(40) : sha,
                              mode: failure === 'wrong mode' ? 'production' : 'e2e',
                          })
                );
            if (failure === 'missing index') rmSync(join(root, 'dist', 'index.html'));
            await expect(prepareSharedE2e(root, sha)).rejects.toThrow();
            expect(() => readFileSync(join(root, 'dist', 'static.txt'))).toThrow();
        }
    );

    it('refuses a checkout that differs from GITHUB_SHA before preparing', () => {
        const result = spawnSync(process.execPath, ['scripts/sharedE2eBuild.ts', 'prepare'], {
            cwd: process.cwd(),
            env: { ...process.env, GITHUB_SHA: '0'.repeat(40) },
            encoding: 'utf8',
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('GITHUB_SHA must match the checked-out integration commit');
    });

    it('refuses a symlink in the destination instead of writing through it', async () => {
        const root = fixture();
        const outside = mkdtempSync(join(tmpdir(), 'shared-e2e-outside-'));
        roots.push(outside);
        symlinkSync(outside, join(root, 'dist', 'static-link'));
        mkdirSync(join(root, 'public', 'static-link'));
        writeFileSync(join(root, 'public', 'static-link', 'escape.txt'), 'no');
        await buildSharedE2e(root, sha, async () => {});
        await expect(prepareSharedE2e(root, sha)).rejects.toThrow();
        expect(() => readFileSync(join(outside, 'escape.txt'))).toThrow();
    });
});
