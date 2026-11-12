import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getAutomationParameterRange } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    getAutomationHandlers,
    getAutomationValueAtBeat,
    setAutomationParameterRangeResolver,
} from '#/modules/Automation/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { clearUndoHistory } from '../clearUndoHistory';
import { compileCommandArgumentMetadata } from '../commandArgumentMetadata';
import { createVersionedCommandEnvelope } from '../createVersionedCommandEnvelope';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { executeVersionedCommandEnvelope } from '../executeVersionedCommandEnvelope';
import { getExecutableAppActionToolSchemas } from '../getExecutableAppActionToolSchemas';
import { parseVersionedCommandEnvelope } from '../parseVersionedCommandEnvelope';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';
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
            ...compileCommandArgumentMetadata(action.payload, action.type),
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
