import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPackage, uncacheAll } from '@electron/asar';
import { afterEach, describe, expect, it } from 'vitest';

import { copyDesktopPayload } from '../isolatedDesktopCopy';
import { verifyAsar, verifyResourceTree } from '../verifyDesktopPayload';

const roots: string[] = [];
async function fixture(): Promise<{ root: string; input: string; asar: string }> {
    const root = await mkdtemp(join(tmpdir(), 'sourdaw-desktop-fixture-'));
    roots.push(root);
    const input = join(root, 'input');
    await mkdir(join(input, 'dist'), { recursive: true });
    await mkdir(join(input, 'electron/out'), { recursive: true });
    await writeFile(
        join(input, 'package.json'),
        JSON.stringify({ name: 'sourdaw', version: '1.0.0', type: 'module', main: 'electron/out/main.js' })
    );
    await writeFile(join(input, 'dist/index.html'), 'renderer');
    await writeFile(join(input, 'electron/out/main.js'), 'main');
    const asar = join(root, 'app.asar');
    return { root, input, asar };
}

afterEach(async () => {
    uncacheAll();
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('final desktop payload checks', () => {
    it('accepts a real asar matching the configured source roots and detects changed bytes', async () => {
        const { input, asar } = await fixture();
        await createPackage(input, asar);
        await expect(verifyAsar(asar, input)).resolves.toBeUndefined();
        await writeFile(join(input, 'dist/index.html'), 'changed');
        await expect(verifyAsar(asar, input)).rejects.toThrow('Asar content differs: dist/index.html');
    });

    it.each(['node_modules/a.js', 'dist/leak.map', 'dist/samples/duplicate.wav', 'other.txt'])(
        'rejects forbidden asar entry %s',
        async (name) => {
            const { input, asar } = await fixture();
            await mkdir(join(input, name, '..'), { recursive: true });
            await writeFile(join(input, name), 'unwanted');
            await createPackage(input, asar);
            await expect(verifyAsar(asar, input)).rejects.toThrow(/Unexpected asar (entry|directory)/);
        }
    );

    it.each([
        ['not JSON', '{'],
        ['missing main', JSON.stringify({ name: 'sourdaw', version: '1.0.0', type: 'module' })],
        [
            'changed main',
            JSON.stringify({ name: 'sourdaw', version: '1.0.0', type: 'module', main: 'dist/index.html' }),
        ],
    ])('rejects %s in the actual archived manifest', async (_name, manifest) => {
        const { input, asar } = await fixture();
        const path = join(input, 'package.json');
        const original = JSON.stringify({
            name: 'sourdaw',
            version: '1.0.0',
            type: 'module',
            main: 'electron/out/main.js',
        });
        await writeFile(path, manifest);
        await createPackage(input, asar);
        await writeFile(path, original);
        await expect(verifyAsar(asar, input)).rejects.toThrow();
    });

    it('rejects an archive missing the source manifest entry point', async () => {
        const { input, asar } = await fixture();
        const main = join(input, 'electron/out/main.js');
        await rm(main);
        await createPackage(input, asar);
        await writeFile(main, 'main');
        await expect(verifyAsar(asar, input)).rejects.toThrow('Missing asar entry: electron/out/main.js');
    });

    it('rejects changed and unexpected resource files', async () => {
        const { root } = await fixture();
        const source = join(root, 'source');
        const target = join(root, 'target');
        await mkdir(source);
        await mkdir(target);
        await writeFile(join(source, 'a'), 'one');
        await writeFile(join(target, 'a'), 'one');
        await expect(verifyResourceTree(source, target)).resolves.toBeUndefined();
        await writeFile(join(target, 'a'), 'two');
        await expect(verifyResourceTree(source, target)).rejects.toThrow('Resource bytes differ');
        await writeFile(join(target, 'extra'), 'x');
        await expect(verifyResourceTree(source, target)).rejects.toThrow('Resource inventory differs');
    });
});

describe('desktop fuse control isolation', () => {
    const framework = 'Contents/Frameworks/Electron Framework.framework';
    const target = `${framework}/Electron Framework`;
    const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

    async function frameworkFixture(): Promise<{ root: string; source: string; copy: string }> {
        const { root } = await fixture();
        const source = join(root, 'Source.app');
        const versions = join(source, framework, 'Versions');
        await mkdir(join(versions, 'A'), { recursive: true });
        await writeFile(join(versions, 'A/Electron Framework'), 'source sentinel');
        await symlink('A', join(versions, 'Current'));
        await symlink('Versions/Current/Electron Framework', join(source, target));
        return { root, source, copy: join(root, 'Copy.app') };
    }

    it('shows default copy points the framework back to the source', async () => {
        const { source, copy } = await frameworkFixture();
        await cp(source, copy, { recursive: true });
        expect(await realpath(join(copy, target))).toBe(await realpath(join(source, target)));
    });

    it('mutates only the isolated copy through relative framework links', async () => {
        const { source, copy } = await frameworkFixture();
        const before = hash(await readFile(join(source, target)));
        await copyDesktopPayload(source, copy, join(copy, target));
        expect(await realpath(join(copy, target))).not.toBe(await realpath(join(source, target)));
        await writeFile(join(copy, target), 'mutated copy');
        expect(hash(await readFile(join(source, target)))).toBe(before);
        expect(await readFile(join(copy, target), 'utf8')).toBe('mutated copy');
    });

    it('accepts a symlinked temporary parent', async () => {
        const { root, source } = await frameworkFixture();
        const alias = join(root, 'alias');
        await symlink(root, alias);
        const copy = join(alias, 'Copy.app');
        await copyDesktopPayload(source, copy, join(copy, target));
        expect(await realpath(join(copy, target))).not.toBe(await realpath(join(source, target)));
    });

    it.each(['absolute', 'escaping', 'dangling'])('refuses an %s link before mutation', async (kind) => {
        const { root, source, copy } = await frameworkFixture();
        const outside = join(root, 'outside');
        await writeFile(outside, 'outside sentinel');
        const actual = join(source, framework, 'Versions/A/Electron Framework');
        const before = hash(await readFile(actual));
        await rm(join(source, target));
        const link = kind === 'absolute' ? outside : kind === 'escaping' ? '../../../../outside' : 'missing';
        await symlink(link, join(source, target));
        let mutated = false;
        await expect(
            (async () => {
                await copyDesktopPayload(source, copy, join(copy, target));
                mutated = true;
                await writeFile(join(copy, target), 'bad');
            })()
        ).rejects.toThrow();
        expect(mutated).toBe(false);
        expect(hash(await readFile(outside))).toBe(hash(Buffer.from('outside sentinel')));
        expect(hash(await readFile(actual))).toBe(before);
    });
});
