import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeIndexedDb } from '../../../__tests__/fakeIndexedDb';

const KEY_A = 'sourdaw:project:1700000000000';
const KEY_B = 'sourdaw:project:1800000000000';

function snapshot(name: string, updatedAt: number): string {
    return JSON.stringify({ version: 1, meta: { name, createdAt: 1700000000000, updatedAt } });
}

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

async function importMigration() {
    const module = await import('../migrateLegacyProjectSnapshots');
    return module.migrateLegacyProjectSnapshots;
}

describe('migrateLegacyProjectSnapshots', () => {
    beforeEach(() => {
        vi.resetModules();
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    // AC-6. The snapshot is recovered into IndexedDB and only then unmirrored.
    it('rewrites each localStorage snapshot into IndexedDB and removes the key', async () => {
        const controls = installFakeIndexedDb();
        const a = snapshot('Alpha', 1700000000000);
        const b = snapshot('Beta', 1800000000000);
        localStorage.setItem(KEY_A, a);
        localStorage.setItem(KEY_B, b);
        const migrateLegacyProjectSnapshots = await importMigration();

        const report = await migrateLegacyProjectSnapshots();

        expect(controls.values.get(KEY_A)).toBe(a);
        expect(controls.values.get(KEY_B)).toBe(b);
        expect(localStorage.getItem(KEY_A)).toBeNull();
        expect(localStorage.getItem(KEY_B)).toBeNull();
        expect(report.recovered).toBe(2);
        expect(report.failed).toBe(0);
    });

    // AC-6. Mutation: removing the write-succeeded gate — calling
    // removeNamedProjectJsonFromLocalStorage outside the success branch — reds
    // `expect(localStorage.getItem(KEY_A)).toBe(a)`.
    it('keeps the localStorage key when the rewrite fails', async () => {
        const controls = installFakeIndexedDb();
        controls.abortWrites();
        const a = snapshot('Alpha', 1700000000000);
        localStorage.setItem(KEY_A, a);
        const migrateLegacyProjectSnapshots = await importMigration();

        const report = await migrateLegacyProjectSnapshots();

        expect(localStorage.getItem(KEY_A)).toBe(a);
        expect(controls.values.has(KEY_A)).toBe(false);
        expect(report.recovered).toBe(0);
        expect(report.failed).toBe(1);
    });

    // AC-6 + AC-4. Migration must not push a stale mirror over a fresher
    // primary — that is the data-loss shape this whole change removes.
    // Mutation: dropping the recency check and always rewriting reds
    // `expect(controls.values.get(KEY_A)).toBe(fresh)`.
    it('drops a stale mirror without overwriting a newer IndexedDB copy', async () => {
        const controls = installFakeIndexedDb();
        const stale = snapshot('Frozen', 1700000000000);
        const fresh = snapshot('Current', 1800000000000);
        localStorage.setItem(KEY_A, stale);
        controls.values.set(KEY_A, fresh);
        const migrateLegacyProjectSnapshots = await importMigration();

        const report = await migrateLegacyProjectSnapshots();

        expect(controls.values.get(KEY_A)).toBe(fresh);
        expect(localStorage.getItem(KEY_A)).toBeNull();
        expect(report.supersededByPrimary).toBe(1);
    });

    // AC-8 evidence. The report distinguishes mirrors that had no IndexedDB
    // counterpart — the `if (!db) return` population — from those that did.
    it('reports how many mirrors had no IndexedDB counterpart', async () => {
        const controls = installFakeIndexedDb();
        localStorage.setItem(KEY_A, snapshot('OnlyInMirror', 1700000000000));
        localStorage.setItem(KEY_B, snapshot('AlsoInPrimary', 1700000000000));
        controls.values.set(KEY_B, snapshot('AlsoInPrimary', 1700000000000));
        const migrateLegacyProjectSnapshots = await importMigration();

        const report = await migrateLegacyProjectSnapshots();

        expect(report.mirrorsWithoutPrimary).toBe(1);
        expect(report.inspected).toBe(2);
    });

    it('leaves unrelated localStorage keys untouched', async () => {
        installFakeIndexedDb();
        localStorage.setItem('sourdaw:recent-projects', '[]');
        localStorage.setItem('unrelated', 'value');
        const migrateLegacyProjectSnapshots = await importMigration();

        const report = await migrateLegacyProjectSnapshots();

        expect(localStorage.getItem('sourdaw:recent-projects')).toBe('[]');
        expect(localStorage.getItem('unrelated')).toBe('value');
        expect(report.inspected).toBe(0);
    });
});
