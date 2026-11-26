import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

import { defaultTrackState } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { chordTrackStore, midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { parseVersionedCommandEnvelope } from '../parseVersionedCommandEnvelope';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';

const BASE_CHORDS = {
    enabled: true,
    events: [{ id: 'c-1', beat: 0, root: 0, quality: 'major' as const, duration: 4 }],
};
const BASE_NOTES = [
    { id: 'n-1', pitch: 60, startBeat: 0, duration: 1, velocity: 40 },
    { id: 'n-2', pitch: 64, startBeat: 1, duration: 1, velocity: 100 },
];

function createMidiClipFixture(): void {
    setTrackStoreState({
        ...defaultTrackState,
        tracks: [createTrack({ id: 'track-midi', kind: 'midi', name: 'MIDI' })],
    });
    addClip({ id: 'clip-midi', trackId: 'track-midi', startBeat: 0, endBeat: 8, name: 'MIDI clip', type: 'midi' });
    midiStore.set({
        notesByClipId: { 'clip-midi': structuredClone(BASE_NOTES) },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
}

function addChord(payload: Extract<AppAction, { type: 'addChordEvent' }>['payload']): AppAction {
    return { type: 'addChordEvent', payload: { eventId: 'c-new', ...payload } };
}

/** The type-only generated schema admits the action, so only the handler can refuse it. */
function expectSchemaAdmits(action: AppAction): void {
    const { envelope } = createExecutionCommandEnvelope({
        action,
        expectedEffect: 'Edit',
        normalizedProjectRevision: 'revision-1',
    });
    expect(parseVersionedCommandEnvelope(serializeVersionedCommandEnvelope(envelope)).status).toBe('valid');
}

describe('chord-track and velocity commands refuse invalid arguments on the batch route', () => {
    beforeEach(() => {
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        setArrangementEventBus({ emit: async () => undefined });
        clearHandlerRegistry();
        registerHandlerMap(getMidiNoteTransformHandlers());
        createMidiClipFixture();
        chordTrackStore.set(structuredClone(BASE_CHORDS));
    });

    afterEach(() => {
        clearHandlerRegistry();
        sessionStorage.removeItem('sourdaw-undo-session');
    });

    it.each([
        {
            label: 'a duration below the minimum',
            action: addChord({ beat: 0, root: 0, quality: 'major', duration: 0.1 }),
        },
        { label: 'an unknown quality', action: addChord({ beat: 0, root: 0, quality: 'garbage' }) },
        { label: 'a fractional root', action: addChord({ beat: 0, root: 2.5, quality: 'major' }) },
        { label: 'a root above 11', action: addChord({ beat: 0, root: 12, quality: 'major' }) },
        { label: 'a negative root', action: addChord({ beat: 0, root: -1, quality: 'major' }) },
        { label: 'a negative beat', action: addChord({ beat: -1, root: 0, quality: 'major' }) },
    ])('refuses addChordEvent with $label and leaves the chord track unchanged', async ({ action }) => {
        expectSchemaAdmits(action);

        await expect(executeAppActionBatch([action])).resolves.toMatchObject({ status: 'conflicted' });

        expect(chordTrackStore.value).toEqual(BASE_CHORDS);
    });

    it('refuses addChordEvent with a non-finite beat and leaves the chord track unchanged', async () => {
        await expect(
            executeAppActionBatch([addChord({ beat: Number.NaN, root: 0, quality: 'major' })])
        ).resolves.toMatchObject({ status: 'conflicted' });

        expect(chordTrackStore.value).toEqual(BASE_CHORDS);
    });

    it('admits addChordEvent at exactly the minimum duration', async () => {
        await expect(
            executeAppActionBatch([addChord({ beat: 4, root: 7, quality: 'minor', duration: 0.25 })])
        ).resolves.toMatchObject({ status: 'committed' });

        expect(chordTrackStore.value?.events.map((event) => event.id)).toEqual(['c-1', 'c-new']);
    });

    it.each([
        { label: 'minVelocity above maxVelocity', minVelocity: 100, maxVelocity: 50 },
        { label: 'a default maxVelocity below minVelocity', minVelocity: 1, maxVelocity: 0 },
    ])('refuses scaleVelocities with $label and leaves the notes unchanged', async ({ minVelocity, maxVelocity }) => {
        const action: AppAction = {
            type: 'scaleVelocities',
            payload: { clipId: 'clip-midi', curve: 'linear', minVelocity, maxVelocity },
        };
        expectSchemaAdmits(action);

        await expect(executeAppActionBatch([action])).resolves.toMatchObject({ status: 'conflicted' });

        expect(midiStore.value?.notesByClipId['clip-midi']).toEqual(BASE_NOTES);
    });

    it.each([
        { label: 'amount above 1', payload: { clipId: 'clip-midi', amount: 1.5, seed: 1 } },
        { label: 'a negative amount', payload: { clipId: 'clip-midi', amount: -0.1, seed: 1 } },
        { label: 'velocityAmount above 1', payload: { clipId: 'clip-midi', amount: 0.5, velocityAmount: 2, seed: 1 } },
        {
            label: 'a negative velocityAmount',
            payload: { clipId: 'clip-midi', amount: 0.5, velocityAmount: -1, seed: 1 },
        },
    ])('refuses humanizeNotes with $label and leaves the notes unchanged', async ({ payload }) => {
        const action: AppAction = { type: 'humanizeNotes', payload };
        expectSchemaAdmits(action);

        await expect(executeAppActionBatch([action])).resolves.toMatchObject({ status: 'conflicted' });

        expect(midiStore.value?.notesByClipId['clip-midi']).toEqual(BASE_NOTES);
    });
});
