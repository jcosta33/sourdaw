import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type HandlerSessionActionEntry } from '#/utils/handlerContract';

const mocks = vi.hoisted(() => ({
    addClip: vi.fn<(input: { id?: string }) => unknown>(),
    addTrack: vi.fn<(input: { id?: string }) => unknown>(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string }[] } | null>(() => ({ tracks: [] })),
    publishTrackAdded: vi.fn(),
    serializeMidiStateForClips: vi.fn(() => '{"notesByClipId":{}}'),
}));

vi.mock('../../useCases/addTrack', () => ({ addTrack: mocks.addTrack }));
vi.mock('../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('../../useCases/publishTrackAdded', () => ({ publishTrackAdded: mocks.publishTrackAdded }));
vi.mock('../../useCases/clip/addClip', () => ({ addClip: mocks.addClip }));
vi.mock('#/modules/MIDI/useCases', () => ({ serializeMidiStateForClips: mocks.serializeMidiStateForClips }));

import { handleAddClip } from '../clip/handleAddClip';
import { handleAddTrack } from '../track/handleAddTrack';
import { isAddClipSessionEntry, isAddTrackSessionEntry } from '../validateCreationSessionEntries';

type PayloadMutation = (payload: Record<string, unknown>) => void;

/**
 * Builds the entry the real handler emits: describe writes the inverse and the replay action, and
 * execute finalizes the guard those carry. A fixture written by hand would stop tracking the
 * handlers, which is exactly what this validator exists to agree with.
 */
async function buildAddTrackEntry(): Promise<HandlerSessionActionEntry> {
    const action: Parameters<typeof handleAddTrack.describe>[0] = {
        type: 'addTrack',
        payload: { name: 'Bass', kind: 'audio' },
    };
    const described = handleAddTrack.describe(action);
    const trackId = action.payload.id;
    if (trackId === undefined) {
        throw new Error('Expected describe to prepare a track id');
    }
    mocks.addTrack.mockReturnValue({ id: trackId, name: 'Bass', kind: 'audio' });
    await handleAddTrack.execute(action);

    return { action, inverseAction: described.inverseAction ?? null, redoAction: described.redoAction };
}

async function buildAddClipEntry(): Promise<HandlerSessionActionEntry> {
    const action: Parameters<typeof handleAddClip.describe>[0] = {
        type: 'addClip',
        payload: { trackId: 'track-1', name: 'Verse', startBeat: 0, endBeat: 4, type: 'midi' },
    };
    const described = handleAddClip.describe(action);
    if (described.redoAction?.type !== 'addClip' || typeof described.redoAction.payload.id !== 'string') {
        throw new Error('Expected describe to materialize a replay clip id');
    }
    const clipId = described.redoAction.payload.id;
    mocks.addClip.mockReturnValue({ id: clipId, trackId: 'track-1', name: 'Verse', type: 'midi' });
    await handleAddClip.execute(action);

    return { action, inverseAction: described.inverseAction ?? null, redoAction: described.redoAction };
}

function withRedoPayload(entry: HandlerSessionActionEntry, mutate: PayloadMutation): HandlerSessionActionEntry {
    const next = structuredClone(entry);
    if (next.redoAction?.type !== 'addClip') {
        throw new Error('Expected an addClip replay action');
    }
    mutate(next.redoAction.payload);
    return next;
}

function withClipGuard(entry: HandlerSessionActionEntry, mutate: PayloadMutation): HandlerSessionActionEntry {
    const next = structuredClone(entry);
    const guard =
        next.inverseAction?.type === 'discardDuplicatedClip'
            ? next.inverseAction.payload.generatedMidiStateGuard
            : undefined;
    if (!guard) {
        throw new Error('Expected a guarded discardDuplicatedClip inverse');
    }
    mutate(guard);
    return next;
}

function withTrackGuard(entry: HandlerSessionActionEntry, mutate: PayloadMutation): HandlerSessionActionEntry {
    const next = structuredClone(entry);
    if (next.inverseAction?.type !== 'discardCreatedTrack' || !next.inverseAction.payload.generatedMidiStateGuard) {
        throw new Error('Expected a guarded discardCreatedTrack inverse');
    }
    mutate(next.inverseAction.payload.generatedMidiStateGuard);
    return next;
}

describe('isAddTrackSessionEntry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
    });

    it('accepts the entry handleAddTrack describes and executes', async () => {
        expect(isAddTrackSessionEntry(await buildAddTrackEntry())).toBe(true);
    });

    it('rejects an inverse naming a different track than the one the action created', async () => {
        const entry = structuredClone(await buildAddTrackEntry());
        if (entry.inverseAction?.type !== 'discardCreatedTrack') {
            throw new Error('Expected a discardCreatedTrack inverse');
        }
        entry.inverseAction.payload.trackId = 'track-elsewhere';

        expect(isAddTrackSessionEntry(entry)).toBe(false);
    });

    it('rejects a replay action, because addTrack replays through its own creation instead', async () => {
        const entry = await buildAddTrackEntry();

        expect(isAddTrackSessionEntry({ ...entry, redoAction: entry.action })).toBe(false);
    });

    it.each([
        [
            'an entity guard captured before execute finalized it',
            (guard: Record<string, unknown>) => {
                guard.entityJson = '';
            },
        ],
        [
            'an entity guard describing a different track',
            (guard: Record<string, unknown>) => {
                guard.entityJson = JSON.stringify({ id: 'track-elsewhere' });
            },
        ],
        [
            'a guard carrying an unknown key',
            (guard: Record<string, unknown>) => {
                guard.notesJson = '{}';
            },
        ],
        [
            'a guard missing its MIDI projection',
            (guard: Record<string, unknown>) => {
                delete guard.midiByClipIdJson;
            },
        ],
    ])('rejects %s', async (_description, mutate) => {
        expect(isAddTrackSessionEntry(withTrackGuard(await buildAddTrackEntry(), mutate))).toBe(false);
    });
});

describe('isAddClipSessionEntry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
    });

    it('accepts the entry handleAddClip describes and executes', async () => {
        expect(isAddClipSessionEntry(await buildAddClipEntry())).toBe(true);
    });

    it('rejects a replay action naming a different clip than the inverse discards', async () => {
        // Replay and compensation must name one clip: a divergent id would replay the creation onto
        // a clip the inverse never removes, leaving the session undo pointing at the wrong entity.
        const entry = withRedoPayload(await buildAddClipEntry(), (payload) => {
            payload.id = 'clip-elsewhere';
        });

        expect(isAddClipSessionEntry(entry)).toBe(false);
    });

    it('rejects a replay payload carrying a key the action never asked for', async () => {
        const entry = withRedoPayload(await buildAddClipEntry(), (payload) => {
            payload.muted = true;
        });

        expect(isAddClipSessionEntry(entry)).toBe(false);
    });

    it('rejects a replay payload missing a key the action asked for', async () => {
        const entry = withRedoPayload(await buildAddClipEntry(), (payload) => {
            delete payload.endBeat;
        });

        expect(isAddClipSessionEntry(entry)).toBe(false);
    });

    it.each([
        [
            'an entity guard captured before execute finalized it',
            (guard: Record<string, unknown>) => {
                guard.entityJson = '';
            },
        ],
        [
            'an entity guard describing a different clip',
            (guard: Record<string, unknown>) => {
                guard.entityJson = JSON.stringify({ id: 'clip-elsewhere' });
            },
        ],
        [
            'a guard carrying an unknown key',
            (guard: Record<string, unknown>) => {
                guard.notesJson = '{}';
            },
        ],
        [
            'a guard whose MIDI projection is not a record',
            (guard: Record<string, unknown>) => {
                guard.midiByClipIdJson = '[]';
            },
        ],
    ])('rejects %s', async (_description, mutate) => {
        expect(isAddClipSessionEntry(withClipGuard(await buildAddClipEntry(), mutate))).toBe(false);
    });
});
