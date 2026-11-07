// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveConfig } from 'vite';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('same-build persistence inspection entry', () => {
    it('keeps the real index entry and eight direct namespaces only in e2e builds', async () => {
        const e2e = await resolveConfig({ root, mode: 'e2e' }, 'build');
        expect(e2e.build.rolldownOptions.input).toEqual({
            index: resolve(root, 'index.html'),
            'persisted-hydration': resolve(root, 'tests/e2e/persistedHydrationEntry.ts'),
            'direct-project-setup': resolve(root, 'tests/e2e/directProjectSetupEntry.ts'),
        });
        expect(e2e.build.rolldownOptions.preserveEntrySignatures).toBe('strict');
        const output = e2e.build.rolldownOptions.output;
        if (Array.isArray(output) || typeof output?.entryFileNames !== 'function') {
            throw new TypeError('The persistence entry requires its own deterministic filename');
        }
        const entry = readFileSync(resolve(root, 'tests/e2e/persistedHydrationEntry.ts'), 'utf8');
        expect(
            Array.from(entry.matchAll(/export \* as (\w+) from '([^']+)'/g), ([, name, path]) => [name, path])
        ).toEqual([
            ['arrangement', '../../src/modules/Arrangement/stores'],
            ['midi', '../../src/modules/MIDI/stores'],
            ['automation', '../../src/modules/Automation/stores'],
            ['project', '../../src/modules/Project/stores'],
            ['crdt', '../../src/modules/CrdtDocument/useCases'],
            ['inspection', '../../src/modules/CrdtDocument/useCases/agentProjectInspectionPort'],
            ['audio', '../../src/modules/AudioEngine/useCases'],
            ['command', '../../src/modules/Command/useCases'],
        ]);
    });

    it('emits the direct project setup entry at a deterministic e2e path', async () => {
        const e2e = await resolveConfig({ root, mode: 'e2e' }, 'build');
        const output = e2e.build.rolldownOptions.output;
        if (Array.isArray(output) || typeof output?.entryFileNames !== 'function') {
            throw new TypeError('The persistence entry requires its own deterministic filename');
        }
        expect(output.entryFileNames({ name: 'direct-project-setup' })).toBe('e2e/direct-project-setup.js');
        const entry = readFileSync(resolve(root, 'tests/e2e/directProjectSetupEntry.ts'), 'utf8');
        expect(entry).toContain("export { newProject } from '../../src/modules/Project/useCases'");
        expect(entry).not.toMatch(/import\s*\(|new\s+\w+\(\)|createProject|projectStore\.set/);
    });

    it('does not add the inspection entry or change entry signatures in a shipping build', async () => {
        const shipping = await resolveConfig({ root, mode: 'production' }, 'build');
        expect(shipping.build.rolldownOptions.input).toBeUndefined();
        expect(shipping.build.rolldownOptions.preserveEntrySignatures).toBeUndefined();
        expect(shipping.plugins.some((plugin) => plugin.name === 'sourdaw-e2e-persistence-entry')).toBe(false);
    });

    it('retains preview checkout identity and cross-origin isolation for e2e mode', async () => {
        const preview = await resolveConfig({ root, mode: 'e2e' }, 'serve');
        const identity = preview.plugins.find((plugin) => plugin.name === 'sourdaw-e2e-serving-checkout');
        expect(identity?.configurePreviewServer).toBeTypeOf('function');
        expect(preview.preview.headers).toMatchObject({
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        });
        const shipping = await resolveConfig({ root, mode: 'production' }, 'serve');
        expect(shipping.plugins.some((plugin) => plugin.name === 'sourdaw-e2e-serving-checkout')).toBe(false);
    });

    it('serves the direct project setup entry at the deterministic path in e2e dev mode', async () => {
        const dev = await resolveConfig({ root, mode: 'e2e' }, 'serve');
        const plugin = dev.plugins.find((p) => p.name === 'sourdaw-e2e-persistence-entry');
        expect(plugin?.configureServer).toBeTypeOf('function');
    });
});
