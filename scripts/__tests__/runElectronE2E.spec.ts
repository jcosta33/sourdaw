import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    assertPackagedBuildInputsClean,
    createPackagedProvenance,
    validatePackagedProvenance,
} from '../runElectronE2E';

function write(root: string, path: string, value: string): void {
    const target = join(root, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, value);
}

function packagedFixture(): { root: string; arch: NodeJS.Architecture } {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-packaged-provenance-'));
    const arch: NodeJS.Architecture = 'arm64';
    const contents = `release/desktop/mac-${arch}/Sourdaw.app/Contents`;
    write(root, `${contents}/MacOS/Sourdaw`, 'launcher');
    write(root, `${contents}/Resources/app.asar`, 'current application');
    write(root, `${contents}/Info.plist`, '<key>ElectronAsarIntegrity</key><dict><key>Resources/app.asar</key></dict>');
    return { root, arch };
}

describe('Electron packaged E2E provenance', () => {
    it('fails when app.asar is stale even if the executable launcher is unchanged', () => {
        const fixture = packagedFixture();
        try {
            const provenance = createPackagedProvenance(fixture.root, fixture.arch, 'head');
            expect(validatePackagedProvenance(fixture.root, fixture.arch, provenance)).toEqual([]);

            write(
                fixture.root,
                `release/desktop/mac-${fixture.arch}/Sourdaw.app/Contents/Resources/app.asar`,
                'stale application'
            );

            expect(validatePackagedProvenance(fixture.root, fixture.arch, provenance)).toContain(
                `release/desktop/mac-${fixture.arch}/Sourdaw.app/Contents/Resources/app.asar: packaged output drifted`
            );
        } finally {
            rmSync(fixture.root, { recursive: true, force: true });
        }
    });

    it('pins Info.plist integrity metadata and deterministically records unpacked files or their absence', () => {
        const fixture = packagedFixture();
        try {
            const absent = createPackagedProvenance(fixture.root, fixture.arch, 'head');
            expect(absent.unpacked).toEqual({
                path: `release/desktop/mac-${fixture.arch}/Sourdaw.app/Contents/Resources/app.asar.unpacked`,
                state: 'absent',
            });

            const unpacked = `release/desktop/mac-${fixture.arch}/Sourdaw.app/Contents/Resources/app.asar.unpacked`;
            write(fixture.root, `${unpacked}/z.js`, 'z');
            write(fixture.root, `${unpacked}/nested/a.js`, 'a');
            const present = createPackagedProvenance(fixture.root, fixture.arch, 'head');

            expect(present.unpacked.state).toBe('present');
            if (present.unpacked.state !== 'present') {
                throw new Error('Expected app.asar.unpacked provenance');
            }
            expect(Object.keys(present.unpacked.files)).toEqual([`${unpacked}/nested/a.js`, `${unpacked}/z.js`]);
            expect(validatePackagedProvenance(fixture.root, fixture.arch, present)).toEqual([]);
        } finally {
            rmSync(fixture.root, { recursive: true, force: true });
        }
    });

    it('refuses dirty tracked build inputs but ignores generated and ignored package output', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-packaged-inputs-'));
        try {
            execFileSync('git', ['init'], { cwd: root });
            execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: root });
            execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
            write(root, '.gitignore', 'release/desktop/\nelectron/out/\n');
            write(root, 'src/main.ts', 'export const value = 1;\n');
            write(root, 'package.json', '{}\n');
            execFileSync('git', ['add', '.'], { cwd: root });
            execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

            write(root, 'release/desktop/generated', 'ignored');
            write(root, 'electron/out/main.js', 'generated');
            expect(() => assertPackagedBuildInputsClean(root)).not.toThrow();

            write(root, 'src/main.ts', 'export const value = 2;\n');
            expect(() => assertPackagedBuildInputsClean(root)).toThrow(/dirty tracked packaged-build inputs/u);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
