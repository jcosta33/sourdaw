import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeIndexedDb } from '../../../__tests__/fakeIndexedDb';
import { ACTIVE_PROJECT_KEY, LEGACY_PROJECT_STORAGE_KEY, RECENT_PROJECTS_KEY } from '../../../models/ProjectData';

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

    it('leaves the recent-projects index and unrelated keys untouched', async () => {
        installFakeIndexedDb();
        localStorage.setItem(RECENT_PROJECTS_KEY, '[]');
        localStorage.setItem('unrelated', 'value');
        const migrateLegacyProjectSnapshots = await importMigration();

        const report = await migrateLegacyProjectSnapshots();

        expect(localStorage.getItem(RECENT_PROJECTS_KEY)).toBe('[]');
        expect(localStorage.getItem('unrelated')).toBe('value');
        expect(report.inspected).toBe(0);
    });

    // F1. A snapshot is only droppable when a newer copy is CONFIRMED to exist.
    // A corrupt primary is not a confirmation — `readUpdatedAt` returns null for
    // it, and treating "not provably older" as "superseded" is presence
    // preference wearing a recency costume, with deletion as the consequence.
    // Mutation: dropping the mirror whenever the verdict is not 'mirror-newer'
    // reds `expect(localStorage.getItem(KEY_A) ?? controls.values.get(KEY_A)).toBe(mirror)`.
    it('never drops a mirror when the IndexedDB copy is corrupt and unreadable', async () => {
        const controls = installFakeIndexedDb();
        const mirror = snapshot('Recoverable', 1800000000000);
        // A successful read of a truncated string: idbGet resolves, so its
        // catch never fires and the value looks present.
        controls.values.set(KEY_A, '{"version":1,"meta":{"name":"Trunc');
        localStorage.setItem(KEY_A, mirror);
        const migrateLegacyProjectSnapshots = await importMigration();

        const report = await migrateLegacyProjectSnapshots();

        // The mirror survives somewhere it can still be loaded from: either
        // rewritten over the corrupt primary, or left in localStorage.
        expect(localStorage.getItem(KEY_A) ?? controls.values.get(KEY_A)).toBe(mirror);
        expect(report.supersededByPrimary).toBe(0);
    });

    // F1, the other half. When the MIRROR is the unreadable one, rewriting it
    // over a good primary would be the data loss in the opposite direction.
    // Mutation: rewriting on any indeterminate verdict reds
    // `expect(controls.values.get(KEY_A)).toBe(primary)`.
    it('never rewrites an unreadable mirror over a readable IndexedDB copy', async () => {
        const controls = installFakeIndexedDb();
        const primary = snapshot('Good', 1700000000000);
        controls.values.set(KEY_A, primary);
        localStorage.setItem(KEY_A, '{"version":1,"meta":{"name":"Trunc');
        const migrateLegacyProjectSnapshots = await importMigration();

        const report = await migrateLegacyProjectSnapshots();

        expect(controls.values.get(KEY_A)).toBe(primary);
        expect(report.unresolved).toBe(1);
    });

    // F1. Equal timestamps are a confirmation: the primary is not older, so the
    // mirror carries nothing and dropping it is safe.
    it('drops a mirror whose timestamp equals the IndexedDB copy', async () => {
        const controls = installFakeIndexedDb();
        const both = snapshot('Same', 1700000000000);
        controls.values.set(KEY_A, both);
        localStorage.setItem(KEY_A, both);
        const migrateLegacyProjectSnapshots = await importMigration();

        const report = await migrateLegacyProjectSnapshots();

        expect(localStorage.getItem(KEY_A)).toBeNull();
        expect(report.supersededByPrimary).toBe(1);
    });

    // F4. AC-1 is a state, not just a write behaviour: the pre-ADR-0013 active
    // document under `sourdaw-project` must not survive in localStorage.
    // Mutation: skipping the legacy-document step reds
    // `expect(localStorage.getItem(LEGACY_PROJECT_STORAGE_KEY)).toBeNull()`.
    it('recovers the legacy active document into IndexedDB and removes its key', async () => {
        const controls = installFakeIndexedDb();
        const legacy = snapshot('LegacyActive', 1700000000000);
        localStorage.setItem(LEGACY_PROJECT_STORAGE_KEY, legacy);
        const migrateLegacyProjectSnapshots = await importMigration();

        const report = await migrateLegacyProjectSnapshots();

        expect(controls.values.get(ACTIVE_PROJECT_KEY)).toBe(legacy);
        expect(localStorage.getItem(LEGACY_PROJECT_STORAGE_KEY)).toBeNull();
        expect(report.legacyActiveDocument).toBe('recovered');
    });

    // F4 + AC-6. The legacy document gets the same never-delete-unrewritten
    // rule as the named snapshots.
    it('keeps the legacy active document when its rewrite fails', async () => {
        const controls = installFakeIndexedDb();
        controls.abortWrites();
        const legacy = snapshot('LegacyActive', 1700000000000);
        localStorage.setItem(LEGACY_PROJECT_STORAGE_KEY, legacy);
        const migrateLegacyProjectSnapshots = await importMigration();

        const report = await migrateLegacyProjectSnapshots();

        expect(localStorage.getItem(LEGACY_PROJECT_STORAGE_KEY)).toBe(legacy);
        expect(report.legacyActiveDocument).toBe('failed');
    });
});
