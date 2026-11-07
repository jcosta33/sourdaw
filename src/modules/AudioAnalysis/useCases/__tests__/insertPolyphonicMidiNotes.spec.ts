import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppAction } from '#/utils/handlerContract';
import { insertPolyphonicMidiNotes } from '../insertPolyphonicMidiNotes';

const mocks = vi.hoisted(() => ({
    getTransportState: vi.fn(),
    getAllTracks: vi.fn(),
    executeAppActionBatch: vi.fn(async (_actions: AppAction[], _options?: unknown) => ({ status: 'committed' })),
}));
vi.mock('#/modules/Arrangement/useCases', () => ({ getAllTracks: mocks.getAllTracks }));
vi.mock('#/modules/Command/useCases', () => ({ executeAppActionBatch: mocks.executeAppActionBatch }));
vi.mock('#/modules/Transport/useCases', () => ({ getTransportState: mocks.getTransportState }));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    projectRevisionMatchesLiveIgnoringSaveWrites: (revision: string) => revision === 'source-revision',
}));
const sourceClip = { startBeat: 4, endBeat: 8, name: 'Vocal', projectRevision: 'source-revision' };

describe('insertPolyphonicMidiNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAllTracks.mockReturnValue([]);
        mocks.getTransportState.mockReturnValue({ tempo: 120 });
    });

    it('keeps empty-note blank-clip creation in one compensated batch', async () => {
        const result = await insertPolyphonicMidiNotes([], sourceClip, 'audio');
        expect(result).not.toBeNull();
        const [actions, options] = mocks.executeAppActionBatch.mock.calls[0]!;
        expect(actions).toEqual([
            { type: 'addTrack', payload: { id: result!.trackId, kind: 'midi', name: 'Vocal (MIDI)' } },
            {
                type: 'addClip',
                payload: {
                    id: result!.clipId,
                    trackId: result!.trackId,
                    startBeat: 4,
                    endBeat: 8,
                    name: 'Vocal → MIDI (poly)',
                    type: 'midi',
                },
            },
        ]);
        expect(options).toMatchObject({ requireCompensation: true, groupId: expect.any(String) });
    });

    it('reuses MIDI destinations and preserves note conversion laws across 128-note chunks', async () => {
        mocks.getAllTracks.mockReturnValue([{ id: 'midi', kind: 'midi' }]);
        const notes = Array.from({ length: 129 }, (_, index) => ({
            pitchMidi: 60 + (index % 12),
            startTimeSeconds: index * 0.1,
            durationSeconds: 0.01,
            amplitude: 0.5,
        }));
        const result = await insertPolyphonicMidiNotes(notes, sourceClip, 'midi');
        expect(result?.trackId).toBe('midi');
        const actions = mocks.executeAppActionBatch.mock.calls[0]![0];
        expect(actions.map((action) => action.type)).toEqual(['addClip', 'addNotes', 'addNotes']);
        const chunks = actions.flatMap((action) => (action.type === 'addNotes' ? [action.payload.notes] : []));
        expect(chunks.map((chunk) => chunk.length)).toEqual([128, 1]);
        expect(chunks.flat()).toEqual(
            notes.map((note) => ({
                pitch: note.pitchMidi,
                startBeat: note.startTimeSeconds * 2,
                duration: 0.0625,
                velocity: 64,
            }))
        );
    });

    it('waits for actual commit before returning the prepared output', async () => {
        let release!: (value: { status: string }) => void;
        mocks.executeAppActionBatch.mockReturnValueOnce(
            new Promise((resolve) => {
                release = resolve;
            })
        );
        let settled = false;
        const insertion = insertPolyphonicMidiNotes([], sourceClip, 'audio').then((result) => {
            settled = true;
            return result;
        });
        expect(settled).toBe(false);
        release({ status: 'committed' });
        expect(await insertion).not.toBeNull();
    });

    it.each(['rejected', 'failed', 'conflicted', 'ambiguous'])('returns null for %s', async (status) => {
        mocks.executeAppActionBatch.mockResolvedValueOnce({ status });
        expect(await insertPolyphonicMidiNotes([], sourceClip, 'audio')).toBeNull();
    });

    it('refuses output from another source revision without dispatch', async () => {
        expect(
            await insertPolyphonicMidiNotes([], { ...sourceClip, projectRevision: 'old-revision' }, 'audio')
        ).toBeNull();
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('keeps cancellation and the original revision live through batch admission', async () => {
        const controller = new AbortController();
        await insertPolyphonicMidiNotes([], { ...sourceClip, signal: controller.signal }, 'audio');
        const options = mocks.executeAppActionBatch.mock.calls[0]![1] as {
            shouldExecute: () => boolean;
            signal: AbortSignal;
        };
        expect(options.signal).toBe(controller.signal);
        expect(options.shouldExecute()).toBe(true);
        controller.abort();
        expect(options.shouldExecute()).toBe(false);
    });
});
