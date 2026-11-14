import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, getAutomationParameterRange } from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    getAutomationHandlers,
    getAutomationValueAtBeat,
    setAutomationParameterRangeResolver,
} from '#/modules/Automation/useCases';
import {
    captureDurableDocumentWitness,
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { getMidiGrooveHandlers, getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getProjectHandlers } from '#/modules/Project/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { clearHandlerRegistry, getHandlerByType, registerHandlerMap } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { clearUndoHistory } from '../clearUndoHistory';
import { compileCommandArgumentMetadata } from '../commandArgumentMetadata';
import { createVersionedCommandEnvelope } from '../createVersionedCommandEnvelope';
import { executeAppAction } from '../executeAppAction';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { executeVersionedCommandEnvelope } from '../executeVersionedCommandEnvelope';
import { getExecutableAppActionToolSchemas } from '../getExecutableAppActionToolSchemas';
import { getInternalUndoSessionReplayContracts } from '../getInternalUndoSessionReplayContracts';
import { parseVersionedCommandEnvelope } from '../parseVersionedCommandEnvelope';
import { reconcileSessionUndoForProject } from '../reconcileSessionUndoForProject';
import { redo } from '../redo';
import { registerProductionCommandHandlers } from '../registerProductionCommandHandlers';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';
import { stampSessionUndoWitness } from '../stampSessionUndoWitness';
import { undo } from '../undo';

/**
 * The three range tools providers are no longer offered stay executable for what was stored before
 * they were retired: a command naming one still parses through the versioned reader, labels itself,
 * writes its lane and undoes it.
 */

const SECTION = { id: 'section-chorus', name: 'Chorus', startBeat: 16, endBeat: 32, color: '#000000' };

function primeProject(): void {
    const bus = { ...createTrack({ name: 'Hall', kind: 'bus' }), id: 'bus-hall', kind: 'bus' as const, gain: 0.8 };
    const vocal = {
        ...createTrack({ name: 'Lead Vocal', kind: 'audio' }),
        id: 'track-vocal',
        sends: [{ busId: 'bus-hall', level: 0.5, preFader: false }],
    };
    trackStore.set({ tracks: [vocal, bus], selectedTrackId: null });
    markerStore.set({ markers: [], sections: [SECTION] });
    automationStore.set({ lanes: [] });
    transportStore.set({ ...defaultTransportState, timeSignatureNumerator: 4, timeSignatureDenominator: 4 });
}

function storedSendRange(): AppAction {
    return {
        type: 'automateSendRange',
        payload: {
            trackIds: ['track-vocal'],
            busId: 'bus-hall',
            sectionName: 'Chorus',
            reductionDb: 3,
            busName: 'Hall',
            sectionId: SECTION.id,
            startBeat: 16,
            endBeat: 32,
            expectedSends: [{ trackId: 'track-vocal', level: 0.5, preFader: false }],
            expectedSection: { name: 'Chorus', startBeat: 16, endBeat: 32 },
        },
    };
}

function storedTrackGainRange(): AppAction {
    return {
        type: 'automateTrackGainRange',
        payload: {
            trackIds: ['bus-hall'],
            sectionName: 'Chorus',
            gainDb: 1.5,
            sectionId: SECTION.id,
            startBeat: 16,
            endBeat: 32,
            expectedTracks: [
                { trackId: 'bus-hall', trackName: 'Hall', gain: 0.8, automationMode: 'read', frozen: false },
            ],
            expectedSection: { name: 'Chorus', startBeat: 16, endBeat: 32 },
        },
    };
}

function storedSendRanges(): AppAction {
    return {
        type: 'automateSendRanges',
        payload: {
            trackIds: ['track-vocal'],
            busId: 'bus-hall',
            sectionIds: [SECTION.id],
            tailBars: 2,
            targetLevelDb: -12,
            busName: 'Hall',
            expectedTimeSignature: [4, 4],
            ranges: [
                { sectionId: SECTION.id, sectionName: 'Chorus', startBeat: 16, endBeat: 32, automationStartBeat: 24 },
            ],
            expectedTracks: [
                {
                    trackId: 'track-vocal',
                    trackName: 'Lead Vocal',
                    frozen: false,
                    automationMode: 'read',
                    sendLevel: 0.5,
                    sendPreFader: false,
                },
            ],
        },
    };
}

/** The envelope a batch stored before the retirement holds, metadata compiled as execution compiles it. */
function store(action: AppAction): string {
    return serializeVersionedCommandEnvelope(
        createVersionedCommandEnvelope({
            action,
            availableDeviceVersions: {},
            expectedEffect: 'Write the stored range automation',
            normalizedProjectRevision: 'stored-revision',
            ...compileCommandArgumentMetadata(payloadOf(action), action.type),
            reason: 'A batch stored before the range tools were retired',
        })
    );
}

describe('a stored command naming a retired range tool', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap(getAutomationHandlers());
        clearUndoHistory();
        primeProject();
    });

    afterEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
    });

    it.each([
        {
            stored: storedSendRange,
            label: 'Lower 1 vocal sends to Hall by 3 dB in Chorus (16–32)',
            parameterId: 'send:bus-hall',
        },
        {
            stored: storedTrackGainRange,
            label: 'Lift "Hall" (bus-hall) by 1.5 dB only in Chorus beats 16–32',
            parameterId: 'gain',
        },
        {
            stored: storedSendRanges,
            label: 'Ramp 1 sends to -12 dB over the final 2 bars of Chorus',
            parameterId: 'send:bus-hall',
        },
    ])('reads, labels, writes and undoes $label', async ({ stored, label, parameterId }) => {
        const action = stored();
        expect(getExecutableAppActionToolSchemas().map((schema) => schema.function.name)).not.toContain(action.type);

        const serialized = store(action);
        const parsed = parseVersionedCommandEnvelope(serialized);
        expect(parsed).toMatchObject({ status: 'valid', envelope: { operation: action.type } });
        await executeVersionedCommandEnvelope(serialized);

        expect(automationStore.value?.lanes).toEqual([expect.objectContaining({ parameterId })]);
        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual([label]);

        await undo();

        expect(automationStore.value?.lanes).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future.map((entry) => entry.label)).toEqual([label]);
    });
});

/** Every quarter beat across the chorus and a bar either side of it. */
const SAMPLE_BEATS = Array.from({ length: 97 }, (_, index) => 12 + index * 0.25);

/** The lane the action writes, sampled where a listener hears it, after which the write is undone. */
async function sampleRide(actions: readonly AppAction[], parameterId: string): Promise<number[]> {
    await expect(
        executeAppActionBatch([...actions], { groupId: 'ride', requireCompensation: true })
    ).resolves.toMatchObject({
        status: expect.stringMatching(/^committed/),
    });
    const lane = automationStore.value?.lanes.find((candidate) => candidate.parameterId === parameterId);
    if (!lane) {
        throw new Error(`Expected a ${parameterId} lane`);
    }
    const samples = SAMPLE_BEATS.map((beat) => getAutomationValueAtBeat(lane.id, beat) ?? Number.NaN);
    await undo();
    expect(automationStore.value?.lanes).toEqual([]);
    return samples;
}

function rangeWrite(
    payload: Omit<Extract<AppAction, { type: 'automateParameterRange' }>['payload'], 'range'> & {
        range: Extract<AppAction, { type: 'automateParameterRange' }>['payload']['range'];
    }
): AppAction {
    return { type: 'automateParameterRange', payload };
}

describe('the range write a retired tool now asks for', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap(getAutomationHandlers());
        setAutomationParameterRangeResolver(getAutomationParameterRange);
        clearUndoHistory();
        primeProject();
    });

    afterEach(() => {
        setAutomationParameterRangeResolver(null);
        clearHandlerRegistry();
        clearUndoHistory();
    });

    it.each([
        {
            retired: storedSendRange,
            replacement: rangeWrite({
                trackId: 'track-vocal',
                parameterId: 'send:bus-hall',
                range: { section: 'Chorus' },
                deltaDb: -3,
            }),
            parameterId: 'send:bus-hall',
        },
        {
            retired: storedTrackGainRange,
            replacement: rangeWrite({
                trackId: 'bus-hall',
                parameterId: 'gain',
                range: { section: 'Chorus' },
                deltaDb: 1.5,
            }),
            parameterId: 'gain',
        },
        {
            retired: storedSendRanges,
            replacement: rangeWrite({
                trackId: 'track-vocal',
                parameterId: 'send:bus-hall',
                range: { startBeat: 24, endBeat: 32 },
                valueDb: -12,
                rampIn: 8,
            }),
            parameterId: 'send:bus-hall',
        },
    ])(
        'draws the $replacement.payload.parameterId ride $retired.name drew',
        async ({ retired, replacement, parameterId }) => {
            const drawn = await sampleRide([retired()], parameterId);
            const redrawn = await sampleRide([replacement], parameterId);

            for (const [index, value] of drawn.entries()) {
                expect(redrawn[index], `beat ${String(SAMPLE_BEATS[index])}`).toBeCloseTo(value, 12);
            }
        }
    );
});

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const PROJECT_ID = 'retired-range-tool-project';

/** The handler set a boot registers; deferred, the saved history waits for its project to be installed. */
function registerProduction(deferSessionRestore = false): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers(
        [
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
            getMidiNoteTransformHandlers(),
            getMidiGrooveHandlers(),
            getProjectHandlers(),
            getTransportHandlers(),
            getYeastHandlers(),
        ],
        { deferSessionRestore }
    );
}

function reconcile(): void {
    reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
}

type SavedHistory = { past: unknown[]; future: unknown[] };

function isSavedHistory(value: unknown): value is SavedHistory {
    return isRecord(value) && Array.isArray(value.past) && Array.isArray(value.future);
}

/**
 * A project reload: the saved document and the saved session history come back into a fresh boot,
 * which restores the history once the project it was written against is installed. `rewrite` stands
 * in for a history an earlier build saved.
 */
function reloadSavedProject(rewrite?: (saved: SavedHistory) => SavedHistory): SavedHistory {
    flushAutomergeStorageWrites();
    stampSessionUndoWitness();
    const savedHistory: unknown = JSON.parse(sessionStorage.getItem(UNDO_SESSION_KEY) ?? 'null');
    if (!isSavedHistory(savedHistory)) {
        throw new Error('Expected a saved undo history');
    }
    const restoredHistory = rewrite ? rewrite(savedHistory) : savedHistory;
    sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(restoredHistory));
    const current = getCrdtDoc('root');
    if (!current) {
        throw new Error('Expected a project to save');
    }
    const saved = Automerge.save(current);
    removeCrdtDoc('root');
    registerProduction(true);
    expect(undoStore.value).toMatchObject({ past: [], future: [] });
    replaceCrdtDoc({ id: 'root', doc: Automerge.load(saved) });
    projectCrdtToStores({ resetProjections: true });
    reconcile();
    return savedHistory;
}

function savedTypes(entries: readonly unknown[]): string[] {
    return entries.map((entry) => {
        const action = isRecord(entry) ? entry.action : undefined;
        return isRecord(action) && typeof action.type === 'string' ? action.type : 'unknown';
    });
}

function pastTypes(): string[] {
    return (undoStore.value?.past ?? []).map((entry) => (entry.kind === 'action' ? entry.action.type : entry.kind));
}

function lanes(): unknown {
    return structuredClone(automationStore.value?.lanes);
}

function vocalColor(): string | undefined {
    return trackStore.value?.tracks.find((track) => track.id === 'track-vocal')?.color;
}

async function recolorVocal(color: string): Promise<void> {
    await executeAppAction({ type: 'setTrackColor', payload: { trackId: 'track-vocal', color } });
    expect(vocalColor()).toBe(color);
}

async function writeRanges(actions: readonly AppAction[]): Promise<void> {
    await expect(
        executeAppActionBatch([...actions], { groupId: crypto.randomUUID(), requireCompensation: true })
    ).resolves.toMatchObject({ status: expect.stringMatching(/^committed/) });
}

const VOCAL_GAIN_DIP = rangeWrite({
    trackId: 'track-vocal',
    parameterId: 'gain',
    range: { section: 'Chorus' },
    deltaDb: -3,
});
const VOCAL_GAIN_DEEPER_DIP = rangeWrite({
    trackId: 'track-vocal',
    parameterId: 'gain',
    range: { startBeat: 20, endBeat: 24 },
    deltaDb: -6,
});

describe('a range write in the undo history a project reload restores', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('retired range tool session undo');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        clearUndoHistory();
        registerProduction();
        setAutomationParameterRangeResolver(getAutomationParameterRange);
        primeProject();
        flushAutomergeStorageWrites();
        reconcile();
    });

    afterEach(() => {
        setAutomationParameterRangeResolver(null);
        clearHandlerRegistry();
        clearUndoHistory();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each([
        { stored: storedSendRange, inverse: 'removeSendAutomationRange' },
        { stored: storedTrackGainRange, inverse: 'removeTrackGainAutomationRange' },
        { stored: storedSendRanges, inverse: 'removeSendAutomationRanges' },
    ])('restores, undoes and redoes a stored $stored.name behind an older edit', async ({ stored, inverse }) => {
        const action = stored();
        await recolorVocal('#ff5500');
        await executeVersionedCommandEnvelope(store(action));
        const written = lanes();
        expect(written).toHaveLength(1);

        const savedHistory = reloadSavedProject();

        expect(savedTypes(savedHistory.past)).toEqual(['setTrackColor', action.type]);
        expect(savedHistory.past[1]).toMatchObject({ inverseAction: { type: inverse } });
        expect(pastTypes()).toEqual(['setTrackColor', action.type]);
        expect(lanes()).toEqual(written);

        await undo();
        expect(lanes()).toEqual([]);
        await redo();
        expect(lanes()).toEqual(written);
        await undo();
        expect(lanes()).toEqual([]);
        expect(vocalColor()).toBe('#ff5500');

        await undo();
        expect(vocalColor()).not.toBe('#ff5500');
        expect(pastTypes()).toEqual([]);
    });

    it('restores, undoes and redoes a range write that created its lane, behind an older edit', async () => {
        await recolorVocal('#ff5500');
        await writeRanges([VOCAL_GAIN_DIP]);
        const written = lanes();
        expect(written).toHaveLength(1);

        const savedHistory = reloadSavedProject();

        expect(savedTypes(savedHistory.past)).toEqual(['setTrackColor', 'automateParameterRange']);
        expect(savedHistory.past[1]).toMatchObject({ inverseAction: { type: 'removeAutomationLane' } });
        expect(pastTypes()).toEqual(['setTrackColor', 'automateParameterRange']);
        expect(lanes()).toEqual(written);

        await undo();
        expect(lanes()).toEqual([]);
        await redo();
        expect(lanes()).toEqual(written);
        await undo();
        expect(lanes()).toEqual([]);

        await undo();
        expect(vocalColor()).not.toBe('#ff5500');
        expect(pastTypes()).toEqual([]);
    });

    it('restores, undoes and redoes a batch that wrote one lane twice', async () => {
        await writeRanges([VOCAL_GAIN_DIP, VOCAL_GAIN_DEEPER_DIP]);
        const written = lanes();
        expect(written).toHaveLength(1);

        const savedHistory = reloadSavedProject();

        expect(savedHistory.past).toEqual([
            expect.objectContaining({ inverseAction: expect.objectContaining({ type: 'removeAutomationLane' }) }),
            expect.objectContaining({
                inverseAction: expect.objectContaining({ type: 'restoreAutomationLanePoints' }),
            }),
        ]);
        expect(pastTypes()).toEqual(['automateParameterRange', 'automateParameterRange']);
        expect(lanes()).toEqual(written);

        await undo();
        expect(lanes()).toEqual([]);
        await redo();
        expect(lanes()).toEqual(written);
        await undo();
        expect(lanes()).toEqual([]);
        expect(pastTypes()).toEqual([]);
    });

    it('restores a mixed history in order and undoes each entry in turn', async () => {
        const originalColor = vocalColor();
        await recolorVocal('#ff5500');
        await executeVersionedCommandEnvelope(store(storedTrackGainRange()));
        const afterLegacy = lanes();
        await recolorVocal('#00aa00');
        await writeRanges([VOCAL_GAIN_DIP]);
        const afterCreatedLane = lanes();
        await writeRanges([VOCAL_GAIN_DEEPER_DIP]);
        const afterRewrite = lanes();
        await recolorVocal('#0000ff');
        const order = [
            'setTrackColor',
            'automateTrackGainRange',
            'setTrackColor',
            'automateParameterRange',
            'automateParameterRange',
            'setTrackColor',
        ];

        const savedHistory = reloadSavedProject();

        expect(savedTypes(savedHistory.past)).toEqual(order);
        expect(pastTypes()).toEqual(order);
        expect(lanes()).toEqual(afterRewrite);

        await undo();
        expect(vocalColor()).toBe('#00aa00');
        await undo();
        expect(lanes()).toEqual(afterCreatedLane);
        await undo();
        expect(lanes()).toEqual(afterLegacy);
        await undo();
        expect(vocalColor()).toBe('#ff5500');
        await undo();
        expect(lanes()).toEqual([]);
        await undo();
        expect(vocalColor()).toBe(originalColor);
        expect(pastTypes()).toEqual([]);
    });

    /** Older edit, bus gain lane, a write that created the vocal gain lane, one that rewrote it, newer edit. */
    async function writeHistoryAroundTwoRangeWrites(): Promise<{ afterCreatedLane: unknown }> {
        await recolorVocal('#ff5500');
        await executeVersionedCommandEnvelope(store(storedTrackGainRange()));
        await writeRanges([VOCAL_GAIN_DIP]);
        const afterCreatedLane = lanes();
        await writeRanges([VOCAL_GAIN_DEEPER_DIP]);
        await recolorVocal('#0000ff');
        return { afterCreatedLane };
    }

    function busGainLane(): { id: string; points: unknown } {
        const lane = automationStore.value?.lanes.find((candidate) => candidate.trackId === 'bus-hall');
        if (!lane) {
            throw new Error('Expected the bus gain lane');
        }
        return { id: lane.id, points: structuredClone(lane.points) };
    }

    /** The saved history with the inverse of its `index`th entry rewritten as an earlier build or a peer might. */
    function withSavedInverse(
        index: number,
        rewrite: (inverse: Record<string, unknown>, payload: Record<string, unknown>) => void
    ): (saved: SavedHistory) => SavedHistory {
        return (saved) => {
            const past = structuredClone(saved.past);
            const entry = past[index];
            const inverse = isRecord(entry) ? entry.inverseAction : undefined;
            if (!isRecord(inverse) || !isRecord(inverse.payload)) {
                throw new Error(`Expected saved entry ${String(index)} to carry an inverse`);
            }
            rewrite(inverse, inverse.payload);
            return { ...saved, past };
        };
    }

    it.each([
        {
            case: 'names another track lane',
            rewrite: (bus: { id: string; points: unknown }) =>
                withSavedInverse(3, (_inverse, payload) => {
                    payload.laneId = bus.id;
                }),
        },
        {
            case: 'names another track lane by the points it holds',
            rewrite: (bus: { id: string; points: unknown }) =>
                withSavedInverse(3, (_inverse, payload) => {
                    payload.laneId = bus.id;
                    payload.expectedPoints = bus.points;
                }),
        },
    ])('drops a saved range write whose restore $case, with everything older', async ({ rewrite }) => {
        await writeHistoryAroundTwoRangeWrites();
        const bus = busGainLane();
        const written = lanes();

        const savedHistory = reloadSavedProject(rewrite(bus));

        expect(savedTypes(savedHistory.past)[3]).toBe('automateParameterRange');
        // The mirror keeps only the unbroken run nearest the present, so the refused entry strands
        // every entry older than it.
        expect(pastTypes()).toEqual(['setTrackColor']);
        await undo();
        expect(vocalColor()).toBe('#ff5500');
        expect(lanes()).toEqual(written);
        expect(busGainLane()).toEqual(bus);
        expect(pastTypes()).toEqual([]);
    });

    it('drops a saved write that created its lane when its undo restores that lane instead', async () => {
        const { afterCreatedLane } = await writeHistoryAroundTwoRangeWrites();

        const savedHistory = reloadSavedProject(
            withSavedInverse(2, (inverse, payload) => {
                inverse.type = 'restoreAutomationLanePoints';
                payload.points = [];
            })
        );

        expect(savedHistory.past[2]).toMatchObject({ inverseAction: { type: 'removeAutomationLane' } });
        expect(pastTypes()).toEqual(['automateParameterRange', 'setTrackColor']);
        await undo();
        await undo();
        expect(lanes()).toEqual(afterCreatedLane);
        expect(pastTypes()).toEqual([]);
    });

    it('loads a history saved before range writes were kept and undoes it as before', async () => {
        const originalColor = vocalColor();
        await recolorVocal('#ff5500');
        await executeVersionedCommandEnvelope(store(storedTrackGainRange()));
        await recolorVocal('#00aa00');
        const written = lanes();

        // An earlier build saved only the run nearest the present: the range write stopped the walk,
        // so neither it nor anything older reached the saved history.
        reloadSavedProject((saved) => {
            const types = savedTypes(saved.past);
            return { ...saved, past: saved.past.slice(types.lastIndexOf('automateTrackGainRange') + 1) };
        });

        expect(pastTypes()).toEqual(['setTrackColor']);
        await undo();
        expect(vocalColor()).toBe('#ff5500');
        expect(lanes()).toEqual(written);
        expect(pastTypes()).toEqual([]);
        expect(vocalColor()).not.toBe(originalColor);
    });
});

const POINT = { id: 'point-a', beat: 16, value: 0.5, curve: 'linear', tension: 0 } as const;
const LATER_POINT = { id: 'point-b', beat: 24, value: 0.25, curve: 'linear', tension: 0 } as const;

function payloadOf(action: AppAction): Record<string, unknown> {
    if (!('payload' in action) || !isRecord(action.payload)) {
        throw new Error(`Expected ${action.type} to carry a payload`);
    }
    return action.payload;
}

function replayContract(actionType: string): (payload: unknown) => boolean {
    const contract = getInternalUndoSessionReplayContracts().find((candidate) => candidate.actionType === actionType);
    if (contract?.role !== 'internal-replay') {
        throw new Error(`Expected an internal replay contract for ${actionType}`);
    }
    return contract.validateArguments;
}

describe('the saved-history contracts of the range-write inverses', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap(getAutomationHandlers());
        primeProject();
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it.each([
        {
            inverse: 'removeTrackGainAutomationRange',
            valid: payloadOf(storedTrackGainRange()),
            refused: {
                'a missing section id': { sectionId: undefined },
                'an empty section id': { sectionId: '' },
                'track ids not an array': { trackIds: 'bus-hall' },
                'a track id the expectations do not name': { trackIds: ['track-vocal'] },
                'an empty beat span': { startBeat: 32, endBeat: 16 },
                'a section span the beats disagree with': {
                    expectedSection: { name: 'Chorus', startBeat: 0, endBeat: 32 },
                },
                'an unknown field': { smuggled: true },
            },
        },
        {
            inverse: 'removeSendAutomationRange',
            valid: payloadOf(storedSendRange()),
            refused: {
                'a missing bus id': { busId: undefined },
                'an empty bus id': { busId: '' },
                'expected sends not an array': { expectedSends: {} },
                'a track id the expectations do not name': { trackIds: ['bus-hall'] },
                'an empty beat span': { startBeat: 16, endBeat: 16 },
                'an unknown field': { smuggled: true },
            },
        },
        {
            inverse: 'removeSendAutomationRanges',
            valid: payloadOf(storedSendRanges()),
            refused: {
                'a missing bus id': { busId: undefined },
                'ranges not an array': { ranges: 'Chorus' },
                'no ranges': { sectionIds: [], ranges: [] },
                'a range for another section': { sectionIds: ['section-verse'] },
                'a ramp starting after its range ends': {
                    ranges: [
                        {
                            sectionId: SECTION.id,
                            sectionName: 'Chorus',
                            startBeat: 16,
                            endBeat: 32,
                            automationStartBeat: 40,
                        },
                    ],
                },
                'a time signature of zero': { expectedTimeSignature: [0, 4] },
                'an unknown field': { smuggled: true },
            },
        },
        {
            inverse: 'removeAutomationLane',
            valid: { laneId: 'lane-gain', expectedPoints: [POINT, LATER_POINT] },
            refused: {
                'a missing lane id': { laneId: undefined },
                'an empty lane id': { laneId: '' },
                'expected points not an array': { expectedPoints: POINT },
                'expected points out of beat order': { expectedPoints: [LATER_POINT, POINT] },
                'a point with an unknown curve': { expectedPoints: [{ ...POINT, curve: 'warp-drive' }] },
                'an unknown field': { smuggled: true },
            },
        },
        {
            inverse: 'restoreAutomationLanePoints',
            valid: { laneId: 'lane-gain', points: [POINT], expectedPoints: [POINT, LATER_POINT] },
            refused: {
                'a missing lane id': { laneId: undefined },
                'an empty lane id': { laneId: '' },
                'points not an array': { points: POINT },
                'points out of beat order': { points: [LATER_POINT, POINT] },
                'expected points not an array': { expectedPoints: 'lane-gain' },
                'an unknown field': { smuggled: true },
            },
        },
    ])('reads a saved $inverse only in the shape its handler executes', ({ inverse, valid, refused }) => {
        const validateArguments = replayContract(inverse);

        expect(validateArguments(valid)).toBe(true);
        for (const [reason, change] of Object.entries(refused)) {
            const malformed: Record<string, unknown> = { ...valid, ...change };
            for (const [key, value] of Object.entries(change)) {
                if (value === undefined) {
                    delete malformed[key];
                }
            }
            expect(validateArguments(malformed), reason).toBe(false);
        }
    });

    it.each([
        { stored: storedTrackGainRange, level: 'gainDb' },
        { stored: storedSendRange, level: 'reductionDb' },
        { stored: storedSendRanges, level: 'targetLevelDb' },
    ])('keeps a saved $stored.name entry only when it undoes exactly the write it records', ({ stored, level }) => {
        const action = stored();
        const handler = getHandlerByType(action.type);
        const removal = handler?.describe(action).inverseAction;
        if (!handler?.validateSessionEntry || !removal || !('payload' in removal)) {
            throw new Error(`Expected ${action.type} to describe its guarded removal`);
        }
        const otherRemoval = structuredClone(removal);
        Reflect.set(payloadOf(otherRemoval), level, -24);

        expect(handler.validateSessionEntry({ action, inverseAction: removal })).toBe(true);
        expect(handler.validateSessionEntry({ action, inverseAction: null })).toBe(false);
        expect(handler.validateSessionEntry({ action, inverseAction: otherRemoval })).toBe(false);
        expect(handler.validateSessionEntry({ action, inverseAction: removal, redoAction: action })).toBe(false);
    });

    it('keeps a saved parameter range write only when its undo expects the points that write placed', () => {
        const validateSessionEntry = getHandlerByType('automateParameterRange')?.validateSessionEntry;
        if (!validateSessionEntry) {
            throw new Error('Expected automateParameterRange to validate its saved entries');
        }
        const unmaterialized = {
            type: 'automateParameterRange',
            payload: { trackId: 'track-vocal', parameterId: 'gain', range: { section: 'Chorus' }, deltaDb: -3 },
        } satisfies AppAction;
        const writeId = 'automation-range-command-1';
        const action = {
            ...unmaterialized,
            payload: { ...unmaterialized.payload, startBeat: 16, endBeat: 32, writeId },
        } satisfies AppAction;
        const before = { ...POINT, beat: 8 };
        const opening = { ...POINT, id: `${writeId}-point-0` };
        const closing = { ...LATER_POINT, id: `${writeId}-point-1` };
        const removal = {
            type: 'removeAutomationLane',
            payload: { laneId: `${writeId}-lane`, expectedPoints: [opening, closing] },
        } satisfies AppAction;
        const restore = {
            type: 'restoreAutomationLanePoints',
            payload: { laneId: 'lane-gain', points: [before], expectedPoints: [before, opening, closing] },
        } satisfies AppAction;
        const refusedRemovals = {
            'another lane': { laneId: 'lane-gain', expectedPoints: [opening, closing] },
            'no expected points': { laneId: removal.payload.laneId },
            'a point the write did not place': {
                laneId: removal.payload.laneId,
                expectedPoints: [before, opening, closing],
            },
        };
        const refusedRestores = {
            'no expected points': { laneId: 'lane-gain', points: [before] },
            'expected points the write did not place': {
                laneId: 'lane-gain',
                points: [before],
                expectedPoints: [before, POINT],
            },
            'its written points out of order': {
                laneId: 'lane-gain',
                points: [before],
                expectedPoints: [before, { ...opening, id: closing.id }, { ...closing, id: opening.id }],
            },
            'the lane the write creates': { ...restore.payload, laneId: removal.payload.laneId },
            'prior points carrying the write identity': { ...restore.payload, points: [opening] },
        };

        expect(validateSessionEntry({ action, inverseAction: removal })).toBe(true);
        expect(validateSessionEntry({ action, inverseAction: restore })).toBe(true);
        expect(validateSessionEntry({ action: unmaterialized, inverseAction: removal })).toBe(false);
        expect(validateSessionEntry({ action, inverseAction: removal, redoAction: action })).toBe(false);
        for (const [reason, payload] of Object.entries(refusedRemovals)) {
            expect(validateSessionEntry({ action, inverseAction: { ...removal, payload } }), reason).toBe(false);
        }
        for (const [reason, payload] of Object.entries(refusedRestores)) {
            expect(validateSessionEntry({ action, inverseAction: { ...restore, payload } }), reason).toBe(false);
        }
    });
});
