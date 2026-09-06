import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const settledProjectId: { value: string | undefined } = {
        value: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
    };
    return {
        tracks: { value: {} },
        markers: { value: {} },
        automation: { value: {} },
        midi: { value: {} },
        transport: { value: {} },
        project: { value: { initialized: true, loading: false, identityPersistencePending: false } },
        settledProjectId,
    };
});

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
vi.mock('#/modules/Project/stores', () => ({
    getSettledProjectId: () => mocks.settledProjectId.value,
    projectStore: {
        get value() {
            return mocks.project.value;
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
        mocks.project.value = { initialized: true, loading: false, identityPersistencePending: false };
        mocks.settledProjectId.value = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';
    });

    it('serializes each store snapshot and reports the encoded byte size', () => {
        const snapshot = captureSnapshot();
        if (!snapshot) {
            throw new Error('expected a captured snapshot');
        }
        const parsed: unknown = JSON.parse(snapshot.data);
        if (typeof parsed !== 'object' || parsed === null) {
            throw new Error('expected serialized snapshot fields');
        }

        expect(snapshot.ownerProjectId).toBe('aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa');
        expect(Reflect.get(parsed, 'tracks')).toEqual(mocks.tracks.value);
        expect(Reflect.get(parsed, 'markers')).toEqual(mocks.markers.value);
        expect(Reflect.get(parsed, 'transport')).toEqual(mocks.transport.value);
        expect(Reflect.get(parsed, 'midi')).toEqual(mocks.midi.value);
        expect(Reflect.get(parsed, 'automation')).toEqual(mocks.automation.value);
        expect(typeof Reflect.get(parsed, 'timestamp')).toBe('number');
        expect(snapshot.size).toBe(new TextEncoder().encode(snapshot.data).byteLength);
    });

    it.each([
        {
            label: 'uninitialized',
            project: { initialized: false, loading: false, identityPersistencePending: false },
            settledProjectId: undefined,
        },
        {
            label: 'loading',
            project: { initialized: true, loading: true, identityPersistencePending: false },
            settledProjectId: undefined,
        },
        {
            label: 'ownerless',
            project: { initialized: true, loading: false, identityPersistencePending: false },
            settledProjectId: undefined,
        },
    ])('refuses capture while the active project is $label', ({ project, settledProjectId }) => {
        mocks.project.value = project;
        mocks.settledProjectId.value = settledProjectId;

        expect(captureSnapshot()).toBeNull();
    });

    it('captures an initialized canonical project while its initial persistence is pending', () => {
        mocks.project.value = { initialized: true, loading: false, identityPersistencePending: true };

        expect(captureSnapshot()?.ownerProjectId).toBe('aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa');
    });
});
