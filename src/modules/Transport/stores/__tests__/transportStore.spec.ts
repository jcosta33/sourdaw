import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { defaultTransportState, transportStore, type TransportState } from '../transportStore';

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

type DurableTransportState = Pick<
    TransportState,
    | 'tempo'
    | 'timeSignatureNumerator'
    | 'timeSignatureDenominator'
    | 'isLooping'
    | 'loopStart'
    | 'loopEnd'
    | 'metronomeEnabled'
    | 'metronomeVolume'
    | 'punchInEnabled'
    | 'punchInBeat'
    | 'punchOutBeat'
    | 'countInEnabled'
    | 'countInBars'
    | 'preRollEnabled'
    | 'preRollBars'
    | 'masterGain'
>;

type InvalidPayloadCase = {
    label: string;
    payload: unknown;
};

const fake_doc: TestDoc = {};
let mutation_count = 0;

function clear_fake_doc(): void {
    for (const key of Object.keys(fake_doc)) {
        delete fake_doc[key];
    }
}

function configure_fake_crdt_port(): void {
    const port: TestPort = {
        getDoc: () => fake_doc,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            mutation_count += 1;
            changeFn(fake_doc);
        },
    };

    configureAutomergeStoragePort(port);
}

async function flush_pending_frame(): Promise<void> {
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

async function reset_store_and_doc(): Promise<void> {
    transportStore.set({ ...defaultTransportState });
    await flush_pending_frame();
    clear_fake_doc();
    mutation_count = 0;
}

describe('transportStore', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        await reset_store_and_doc();
        configure_fake_crdt_port();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('should have the default transport state', () => {
        expect(transportStore.value).toEqual(defaultTransportState);
    });

    it('should sanitize invalid top-level CRDT hydration to default transport state without throwing', () => {
        fake_doc.transport = 'invalid-transport-state';

        expect(() => transportStore.hydrate()).not.toThrow();

        expect(transportStore.value).toEqual(defaultTransportState);
    });

    it('should sanitize a durable CRDT payload that fully collapses to default state without throwing', async () => {
        // Every case here either invalidates a single field with no other field
        // present, or triggers a cross-field invariant reset (loop/punch trio)
        // whose reset fields are the only ones the payload touched — so the
        // whole result still equals the full default. Per-field preservation
        // alongside a *surviving* valid field is covered separately below.
        const invalid_payloads = [
            { label: 'low tempo', payload: { tempo: 19 } },
            { label: 'high tempo', payload: { tempo: 301 } },
            { label: 'zero numerator', payload: { timeSignatureNumerator: 0 } },
            { label: 'unsupported denominator', payload: { timeSignatureDenominator: 3 } },
            { label: 'negative loop start', payload: { loopStart: -1, loopEnd: 4 } },
            { label: 'inverted loop bounds', payload: { loopStart: 8, loopEnd: 4 } },
            { label: 'enabled zero-length loop', payload: { isLooping: true, loopStart: 8, loopEnd: 8 } },
            { label: 'non-boolean loop toggle', payload: { isLooping: 'true' } },
            { label: 'high metronome volume', payload: { metronomeVolume: 1.1 } },
            { label: 'non-boolean metronome toggle', payload: { metronomeEnabled: 'yes' } },
            { label: 'negative punch in', payload: { punchInBeat: -1 } },
            { label: 'negative punch out', payload: { punchInBeat: 0, punchOutBeat: -1 } },
            { label: 'NaN punch in', payload: { punchInBeat: Number.NaN, punchOutBeat: 32 } },
            {
                label: 'positive infinity punch out',
                payload: { punchInBeat: 4, punchOutBeat: Number.POSITIVE_INFINITY },
            },
            {
                label: 'negative infinity punch in',
                payload: { punchInBeat: Number.NEGATIVE_INFINITY, punchOutBeat: 32 },
            },
            { label: 'inverted punch bounds', payload: { punchInBeat: 4, punchOutBeat: 4 } },
            { label: 'non-boolean punch toggle', payload: { punchInEnabled: 'yes' } },
            { label: 'zero count-in bars', payload: { countInBars: 0 } },
            { label: 'fractional count-in bars', payload: { countInBars: 1.5 } },
            { label: 'non-boolean count-in toggle', payload: { countInEnabled: 'yes' } },
            { label: 'high pre-roll bars', payload: { preRollBars: 9 } },
            { label: 'fractional pre-roll bars', payload: { preRollBars: 1.5 } },
            { label: 'non-boolean pre-roll toggle', payload: { preRollEnabled: 'yes' } },
            { label: 'negative master gain', payload: { masterGain: -1 } },
            { label: 'over-ceiling master gain', payload: { masterGain: 250 } },
        ] satisfies InvalidPayloadCase[];

        for (const invalid_payload of invalid_payloads) {
            await reset_store_and_doc();
            fake_doc.transport = invalid_payload.payload;

            expect(() => transportStore.hydrate()).not.toThrow();
            expect(transportStore.value, invalid_payload.label).toEqual(defaultTransportState);
            await flush_pending_frame();
        }
    });

    it('should reset only the invalid field and preserve every other valid durable field (per-field fallback)', async () => {
        fake_doc.transport = { tempo: 999, metronomeVolume: 0.5 };

        expect(() => transportStore.hydrate()).not.toThrow();

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            tempo: defaultTransportState.tempo,
            metronomeVolume: 0.5,
        });
    });

    it('should reset only the loop trio when the loop configuration is invalid, preserving tempo and master gain', async () => {
        fake_doc.transport = { tempo: 140, masterGain: 90, loopStart: 8, loopEnd: 4 };

        expect(() => transportStore.hydrate()).not.toThrow();

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            tempo: 140,
            masterGain: 90,
            isLooping: defaultTransportState.isLooping,
            loopStart: defaultTransportState.loopStart,
            loopEnd: defaultTransportState.loopEnd,
        });
    });

    it('should reset only the punch trio when the punch configuration is invalid, preserving tempo and master gain', async () => {
        fake_doc.transport = { tempo: 140, masterGain: 90, punchInBeat: 8, punchOutBeat: 4 };

        expect(() => transportStore.hydrate()).not.toThrow();

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            tempo: 140,
            masterGain: 90,
            punchInEnabled: defaultTransportState.punchInEnabled,
            punchInBeat: defaultTransportState.punchInBeat,
            punchOutBeat: defaultTransportState.punchOutBeat,
        });
    });

    it('should reset the full loop trio when loopStart is present but rejected, even though the fallback loopEnd alone would satisfy ordering', async () => {
        // loopStart is invalid and falls back to the default (0), which would
        // satisfy `loopEnd (16) >= loopStart (0)` on its own — fabricating a
        // [0, 16] loop the snapshot never authored. The trio must reset
        // because loopStart was present-but-rejected, not because the
        // post-fallback state happens to look consistent.
        fake_doc.transport = { tempo: 140, masterGain: 90, isLooping: true, loopStart: -1, loopEnd: 16 };

        expect(() => transportStore.hydrate()).not.toThrow();

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            tempo: 140,
            masterGain: 90,
            isLooping: defaultTransportState.isLooping,
            loopStart: defaultTransportState.loopStart,
            loopEnd: defaultTransportState.loopEnd,
        });
    });

    it('should reset the full punch trio when punchInBeat is present but rejected, even though the fallback punchInBeat alone would satisfy ordering', async () => {
        // punchInBeat is invalid and falls back to the default (0), which
        // would satisfy `punchOutBeat (32) > punchInBeat (0)` on its own —
        // arming punch from beat 0 instead of refusing the whole trio.
        fake_doc.transport = { tempo: 140, masterGain: 90, punchInEnabled: true, punchInBeat: -1, punchOutBeat: 32 };

        expect(() => transportStore.hydrate()).not.toThrow();

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            tempo: 140,
            masterGain: 90,
            punchInEnabled: defaultTransportState.punchInEnabled,
            punchInBeat: defaultTransportState.punchInBeat,
            punchOutBeat: defaultTransportState.punchOutBeat,
        });
    });

    it('should merge valid partial durable CRDT hydration over defaults without preserving stale cached fields', () => {
        transportStore.set({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: true,
            overdubEnabled: true,
            playheadPosition: 44,
            scheduleGrainMs: 25,
            tempo: 220,
            timeSignatureNumerator: 11,
            timeSignatureDenominator: 16,
            metronomeVolume: 0.1,
        });
        fake_doc.transport = {
            tempo: 132,
            isLooping: true,
            loopStart: 4,
            loopEnd: 12,
            metronomeEnabled: true,
            metronomeVolume: 0.75,
            punchInEnabled: true,
            punchInBeat: 2,
            punchOutBeat: 10,
            countInEnabled: true,
            countInBars: 2,
            preRollEnabled: true,
            preRollBars: 3,
            masterGain: 90,
        };

        transportStore.hydrate();

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            tempo: 132,
            isLooping: true,
            loopStart: 4,
            loopEnd: 12,
            metronomeEnabled: true,
            metronomeVolume: 0.75,
            punchInEnabled: true,
            punchInBeat: 2,
            punchOutBeat: 10,
            countInEnabled: true,
            countInBars: 2,
            preRollEnabled: true,
            preRollBars: 3,
            masterGain: 90,
        });
    });

    it('should preserve valid durable CRDT hydration without writing back', async () => {
        const durable_state = {
            tempo: 160,
            timeSignatureNumerator: 7,
            timeSignatureDenominator: 8,
            isLooping: true,
            loopStart: 4,
            loopEnd: 16,
            metronomeEnabled: true,
            metronomeVolume: 0.25,
            punchInEnabled: true,
            punchInBeat: 2,
            punchOutBeat: 12,
            countInEnabled: true,
            countInBars: 4,
            preRollEnabled: true,
            preRollBars: 3,
            masterGain: 95,
        } satisfies DurableTransportState;
        fake_doc.transport = durable_state;

        transportStore.hydrate();
        await flush_pending_frame();

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            ...durable_state,
        });
        expect(mutation_count).toBe(0);
    });

    it('should strip extra CRDT fields before consumers observe transport state', () => {
        fake_doc.transport = {
            tempo: 140,
            hiddenTopLevel: true,
        };

        transportStore.hydrate();

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            tempo: 140,
        });
    });
});
