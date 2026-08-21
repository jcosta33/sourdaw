import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    assertElectronBuildInputsClean,
    assertPackagedBuildInputsClean,
    createPackagedProvenance,
    DDSP_RUNTIME_LEGAL_FILES,
    runWithCleanElectronBuildInputs,
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
    for (const name of DDSP_RUNTIME_LEGAL_FILES) {
        write(root, `${contents}/Resources/legal/${name}`, `legal:${name}`);
    }
    return { root, arch };
}

describe('Electron packaged E2E provenance', () => {
    it('should fail when app.asar is stale even if the executable launcher is unchanged', () => {
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

    it('should pin Info.plist integrity metadata and deterministically record unpacked files or their absence', () => {
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

    it('should pin every shipped DDSP runtime legal file and reject each removed or changed resource', () => {
        const fixture = packagedFixture();
        const legalRoot = `release/desktop/mac-${fixture.arch}/Sourdaw.app/Contents/Resources/legal`;
        try {
            const provenance = createPackagedProvenance(fixture.root, fixture.arch, 'head');
            for (const name of DDSP_RUNTIME_LEGAL_FILES) {
                expect(provenance.files[`${legalRoot}/${name}`]).toMatch(/^[0-9a-f]{64}$/u);
            }
            expect(validatePackagedProvenance(fixture.root, fixture.arch, provenance)).toEqual([]);

            for (const name of DDSP_RUNTIME_LEGAL_FILES) {
                write(fixture.root, `${legalRoot}/${name}`, 'changed notice');
                expect(validatePackagedProvenance(fixture.root, fixture.arch, provenance)).toContain(
                    `${legalRoot}/${name}: packaged output drifted`
                );
                write(fixture.root, `${legalRoot}/${name}`, `legal:${name}`);
                rmSync(join(fixture.root, `${legalRoot}/${name}`));
                expect(validatePackagedProvenance(fixture.root, fixture.arch, provenance)).toContain(
                    `${legalRoot}/${name}: packaged output missing`
                );
                write(fixture.root, `${legalRoot}/${name}`, `legal:${name}`);
            }
        } finally {
            rmSync(fixture.root, { recursive: true, force: true });
        }
    });

    it('should refuse tracked or untracked build inputs but ignore generated and ignored package output', () => {
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

            write(root, 'src/untracked.ts', 'export const untracked = true;\n');
            write(root, 'public/untracked.txt', 'untracked\n');
            expect(() => assertPackagedBuildInputsClean(root)).toThrow(
                /public\/untracked\.txt[\s\S]*src\/untracked\.ts/u
            );
            rmSync(join(root, 'src/untracked.ts'));
            rmSync(join(root, 'public/untracked.txt'));

            write(root, 'src/main.ts', 'export const value = 2;\n');
            expect(() => assertPackagedBuildInputsClean(root)).toThrow(/dirty packaged-build inputs/u);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('should check development inputs before running the build and reject dirty renderer files', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-development-inputs-'));
        try {
            execFileSync('git', ['init'], { cwd: root });
            execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: root });
            execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
            write(root, '.gitignore', 'dist/\nelectron/out/\n');
            write(root, 'src/main.ts', 'export const value = 1;\n');
            write(root, 'public/runtime.txt', 'runtime\n');
            write(root, 'package.json', '{}\n');
            execFileSync('git', ['add', '.'], { cwd: root });
            execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

            let buildCount = 0;
            runWithCleanElectronBuildInputs(
                'development',
                () => {
                    buildCount += 1;
                },
                root
            );
            expect(buildCount).toBe(1);

            write(root, 'src/main.ts', 'export const value = 2;\n');
            write(root, 'public/untracked.txt', 'untracked\n');
            expect(() =>
                runWithCleanElectronBuildInputs(
                    'development',
                    () => {
                        buildCount += 1;
                    },
                    root
                )
            ).toThrow(/dirty development-build inputs/u);
            expect(buildCount).toBe(1);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('should reject dirty or untracked root index.html in both build modes while allowing ignored outputs', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-index-input-'));
        try {
            execFileSync('git', ['init'], { cwd: root });
            execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: root });
            execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
            write(root, '.gitignore', 'dist/\nelectron/out/\n');
            write(root, 'package.json', '{}\n');
            execFileSync('git', ['add', '.'], { cwd: root });
            execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

            write(root, 'dist/index.html', 'generated');
            write(root, 'electron/out/main.js', 'generated');
            expect(() => assertElectronBuildInputsClean(root, 'development')).not.toThrow();
            expect(() => assertElectronBuildInputsClean(root, 'packaged')).not.toThrow();

            write(root, 'index.html', '<main>untracked build input</main>');
            expect(() => assertElectronBuildInputsClean(root, 'development')).toThrow(/\?\? index\.html/u);
            expect(() => assertElectronBuildInputsClean(root, 'packaged')).toThrow(/\?\? index\.html/u);

            execFileSync('git', ['add', 'index.html'], { cwd: root });
            execFileSync('git', ['commit', '-m', 'track index'], { cwd: root });
            write(root, 'index.html', '<main>dirty build input</main>');
            expect(() => assertElectronBuildInputsClean(root, 'development')).toThrow(/index\.html/u);
            expect(() => assertElectronBuildInputsClean(root, 'packaged')).toThrow(/index\.html/u);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
