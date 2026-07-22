import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { executeAppAction } from '#/modules/Command/useCases';

import { chordTrackStore } from '../../stores/chordTrackStore';
import { getChordTrackHandlers } from '../getChordTrackHandlers';
import { readLegacyChordTrackMigration } from '../readLegacyChordTrackMigration';

const STORAGE_KEY = 'sourdaw_chord_track';
type RootDocument = Record<string, unknown> & { chordTrack?: unknown };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

let doc: Doc<RootDocument>;

describe('readLegacyChordTrackMigration', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        flushAutomergeStorageWrites();
        clearHandlerRegistry();
        registerHandlerMap(getChordTrackHandlers());
        doc = from<RootDocument>({});
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => docId === 'root',
            mutateDoc: ({ changeFn }: Parameters<TestPort['mutateDoc']>[0]) => {
                doc = change(doc, (draft) => changeFn(draft));
            },
        });
        chordTrackStore.hydrate();
        localStorage.removeItem(STORAGE_KEY);
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        localStorage.removeItem(STORAGE_KEY);
    });

    it('returns a validated restore action and removes storage only when instructed', () => {
        const state = {
            enabled: true,
            events: [{ id: 'legacy', beat: 0, root: 5, quality: 'major', duration: 4 }],
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

        const migration = readLegacyChordTrackMigration();

        expect(migration?.action).toEqual({
            type: 'restoreChordTrackState',
            payload: { expected: { enabled: false, events: [] }, replacement: state },
        });
        expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
        migration?.remove();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('commits legacy storage into an empty real CRDT root without seeding chord truth', async () => {
        const state = {
            enabled: true,
            events: [{ id: 'legacy', beat: 8, root: 7, quality: 'min7', duration: 4 }],
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        const migration = readLegacyChordTrackMigration();
        if (!migration) {
            throw new Error('Expected a valid legacy migration');
        }

        await executeAppAction(migration.action, { skipMacroRecording: true, skipUndo: true });

        expect(doc.chordTrack).toMatchObject({ schemaVersion: 1, enabled: true });
        expect(chordTrackStore.value).toEqual(state);
        expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    });

    it.each([
        ['malformed JSON', '{ invalid'],
        ['invalid state', JSON.stringify({ enabled: 'yes', events: [] })],
        [
            'empty event ID',
            JSON.stringify({
                enabled: true,
                events: [{ id: '', beat: 0, root: 5, quality: 'major', duration: 4 }],
            }),
        ],
    ])('preserves %s for a future compatible migration', (_label, raw) => {
        localStorage.setItem(STORAGE_KEY, raw);

        expect(readLegacyChordTrackMigration()).toBeNull();
        expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    });
});
