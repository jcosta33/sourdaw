import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePnpmLock } from '../pnpmLock';

const tooling = `lockfileVersion: '9.0'
importers:
  .:
    configDependencies: {}
    packageManagerDependencies:
      pnpm: {specifier: 12.18.0, version: 12.18.0}
packages:
  pnpm@12.18.0:
    resolution: {integrity: sha512-manager}
snapshots: {}
`;
const application = `lockfileVersion: '9.0'
importers:
  .:
    devDependencies:
      electron: {specifier: 1.2.3, version: 1.2.3(peer@1.0.0)}
packages:
  electron@1.2.3:
    resolution: {integrity: sha512-application}
snapshots: {}
`;
const combined = `${tooling}---\n${application}`;

describe('pnpm lock document authority', () => {
    it('reads the real current lock without hiding either package graph', () => {
        const root = resolve(import.meta.dirname, '../..');
        const lock = parsePnpmLock(readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8'));
        const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
        expect(lock.application.importers?.['.']?.devDependencies?.electron?.specifier).toBe(
            manifest.devDependencies.electron
        );
        expect(lock.packages[manifest.packageManager]).toBeDefined();
        expect(lock.application.importers?.['.']?.packageManagerDependencies).toBeUndefined();
        expect(lock.packages[`electron@${manifest.devDependencies.electron}`]?.resolution?.integrity).toBeDefined();
    });

    it('separates application importer and resolution authority from proof identity lookup', () => {
        const lock = parsePnpmLock(combined);
        expect(lock.application.importers?.['.']?.devDependencies?.electron).toMatchObject({
            specifier: '1.2.3',
            version: '1.2.3(peer@1.0.0)',
        });
        expect(lock.application.packages['pnpm@12.18.0']).toBeUndefined();
        expect(lock.packages['pnpm@12.18.0']?.resolution?.integrity).toBe('sha512-manager');
        expect(lock.packages['electron@1.2.3']?.resolution?.integrity).toBe('sha512-application');
    });

    it('keeps packages-only proof fixtures valid', () => {
        expect(
            parsePnpmLock('packages:\n  fixture@1.0.0: {resolution: {integrity: sha512-fixture}}\n').packages[
                'fixture@1.0.0'
            ]?.resolution?.integrity
        ).toBe('sha512-fixture');
    });

    it('accepts a bounded alias with the same package identity evidence', () => {
        const lock = parsePnpmLock(
            'packages:\n  fixture@1.0.0: &entry {resolution: {integrity: sha512-fixture}}\n  fixture@1.0.0(peer@2.0.0): *entry\n'
        );
        expect(lock.packages['fixture@1.0.0(peer@2.0.0)']?.resolution?.integrity).toBe('sha512-fixture');
    });

    it('accepts a benign duplicate archive identity across documents', () => {
        const lock = parsePnpmLock(
            `${tooling}---\n${application.replace('electron@1.2.3:', 'pnpm@12.18.0:').replace('sha512-application', 'sha512-manager')}`
        );
        expect(lock.packages['pnpm@12.18.0']?.resolution?.integrity).toBe('sha512-manager');
    });

    it.each([
        ['package-manager', `${tooling.replace('packages:', 'packages: {}\npackages:')}---\n${application}`],
        ['application', `${tooling}---\n${application.replace('packages:', 'packages: {}\npackages:')}`],
    ])('rejects duplicate keys in the %s document', (_name, source) => {
        expect(() => parsePnpmLock(source)).toThrow('Map keys must be unique');
    });

    it.each([
        ['duplicate application', `${application}---\n${application}`],
        ['duplicate package-manager', `${tooling}---\n${tooling}`],
        ['extra document', `${combined}---\npackages: {}\n`],
        ['missing application', tooling],
        ['empty', ''],
        ['scalar', 'unrecognized'],
        ['scalar second', `${tooling}---\nunrecognized`],
        ['empty second', `${tooling}---\n`],
        ['malformed', `${tooling}---\npackages: [unterminated`],
        ['unrecognized', `${tooling}---\nother: {}\n`],
        ['scalar packages', 'packages: unrecognized'],
        ['array packages', 'packages: []'],
        ['scalar package', 'packages: {fixture@1.0.0: unrecognized}'],
        ['scalar resolution', 'packages: {fixture@1.0.0: {resolution: unrecognized}}'],
        ['nonstrings integrity', 'packages: {fixture@1.0.0: {resolution: {integrity: []}}}'],
        ['scalar importers', 'importers: unrecognized\npackages: {}'],
        ['scalar importer', 'importers: {.: unrecognized}\npackages: {}'],
        ['scalar dependencies', 'importers: {.: {dependencies: unrecognized}}\npackages: {}'],
        ['scalar dependency', 'importers: {.: {dependencies: {fixture: unrecognized}}}\npackages: {}'],
        ['nonstrings version', 'importers: {.: {dependencies: {fixture: {version: []}}}}\npackages: {}'],
        [
            'PM importer masquerade',
            `${tooling.replace('configDependencies: {}', 'dependencies: {electron: {specifier: 1.2.3, version: 1.2.3}}')}---\n${application}`,
        ],
        ['PM document masquerade', `${tooling}settings: {}\n---\n${application}`],
        ['conflicting exact identity', `${tooling}---\n${application.replace('electron@1.2.3:', 'pnpm@12.18.0:')}`],
        [
            'conflicting peer identity',
            `${tooling}---\n${application.replace('electron@1.2.3:', 'pnpm@12.18.0(peer@1.0.0):')}`,
        ],
        [
            'conflicting local peer identity',
            'packages:\n  fixture@1.0.0: {resolution: {integrity: sha512-one}}\n  fixture@1.0.0(peer@1.0.0): {resolution: {integrity: sha512-two}}',
        ],
        ['unknown tag', 'packages: !unrecognized {}'],
    ])('refuses %s before returning any authority', (_name, source) => {
        expect(() => parsePnpmLock(source)).toThrow();
    });

    it('bounds alias expansion before converting document authority', () => {
        const source =
            'a: &a [x,x,x,x,x,x,x,x,x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\npackages: {}';
        expect(() => parsePnpmLock(source)).toThrow('Excessive alias count');
    });
});
