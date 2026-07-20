import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    tracks: { value: {} },
    markers: { value: {} },
    automation: { value: {} },
    midi: { value: {} },
    transport: { value: {} },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.tracks.value;
        },
    },
    markerStore: {
        get value() {
            return mocks.markers.value;
        },
    },
}));
vi.mock('#/modules/Automation/stores', () => ({
    automationStore: {
        get value() {
            return mocks.automation.value;
        },
    },
}));
vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midi.value;
        },
    },
}));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return mocks.transport.value;
        },
    },
}));

const { captureSnapshot } = await import('../captureSnapshot');

describe('captureSnapshot', () => {
    beforeEach(() => {
        mocks.tracks.value = { tracks: [{ id: 't1' }] };
        mocks.markers.value = { markers: [] };
        mocks.automation.value = { lanes: [] };
        mocks.midi.value = { notesByClipId: {} };
        mocks.transport.value = { tempo: 120 };
    });

    it('serializes each store snapshot and reports the encoded byte size', () => {
        const snapshot = captureSnapshot();
        const parsed = JSON.parse(snapshot.data) as Record<string, unknown>;

        expect(parsed.tracks).toEqual(mocks.tracks.value);
        expect(parsed.markers).toEqual(mocks.markers.value);
        expect(parsed.transport).toEqual(mocks.transport.value);
        expect(parsed.midi).toEqual(mocks.midi.value);
        expect(parsed.automation).toEqual(mocks.automation.value);
        expect(typeof parsed.timestamp).toBe('number');
        expect(snapshot.size).toBe(new TextEncoder().encode(snapshot.data).byteLength);
    });
});
