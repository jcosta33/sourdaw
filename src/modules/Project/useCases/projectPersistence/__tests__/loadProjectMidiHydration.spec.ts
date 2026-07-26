import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, type MarkerStoreState } from '#/modules/Arrangement/stores';
import { projectCrdtToStores } from '#/modules/CrdtDocument/useCases';
import { LEGACY_MIDI_PROBABILITY_SEED, midiStore, type MidiStoreState } from '#/modules/MIDI/stores';

import { resetModuleStoresToDefault } from '../helpers/resetModuleStoresToDefault';

type RootDocument = {
    midi?: MidiStoreState;
    markers?: MarkerStoreState;
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

function createPeer(initialDoc: Doc<RootDocument>): { getDoc: () => Doc<RootDocument>; port: TestPort } {
    let doc = initialDoc;
    return {
        getDoc: () => doc,
        port: {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => docId === 'root',
            mutateDoc: ({ changeFn }) => {
                doc = change(doc, (draft) => changeFn(draft));
            },
        },
    };
}

function persistedMidiState(): MidiStoreState {
    return {
        probabilitySeed: 0xdecafbad,
        notesByClipId: {
            'persisted-clip': [
                {
                    id: 'persisted-note',
                    pitch: 60,
                    startBeat: 0,
                    duration: 1,
                    velocity: 100,
                    probability: 50,
                },
            ],
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    };
}

function defaultMidiState(): MidiStoreState {
    return {
        probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
    };
}

function readMidiDocument(peer: ReturnType<typeof createPeer>): unknown {
    const midi = peer.getDoc().midi;
    if (midi === undefined) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(midi));
}

function persistedMarkerState(): MarkerStoreState {
    return {
        markers: [{ id: 'persisted-marker', beat: 0, name: 'Horizon', color: 'blue' }],
        sections: [
            {
                id: 'persisted-section',
                startBeat: 0,
                endBeat: 64,
                name: 'Sporefall',
                color: 'purple',
            },
        ],
    };
}

function readMarkerDocument(peer: ReturnType<typeof createPeer>): unknown {
    const markers = peer.getDoc().markers;
    if (markers === undefined) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(markers));
}

describe('project-load MIDI hydration', () => {
    const frameCallbacks: FrameRequestCallback[] = [];

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        flushAutomergeStorageWrites();
        midiStore.set(defaultMidiState());
        flushAutomergeStorageWrites();

        markerStore.set({ markers: [], sections: [] });
        flushAutomergeStorageWrites();
        frameCallbacks.length = 0;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            frameCallbacks.push(callback);
            return frameCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
    });

    it('preserves persisted MIDI through reset, projection, and the deferred frame', () => {
        const persisted = persistedMidiState();
        const peer = createPeer(from<RootDocument>({ midi: persisted }));
        configureAutomergeStoragePort(peer.port);

        resetModuleStoresToDefault({
            resetGrooveTemplates: false,
            resetMidiState: false,
            resetYeastState: false,
        });
        projectCrdtToStores();

        while (frameCallbacks.length > 0) {
            frameCallbacks.shift()?.(100);
        }

        expect(midiStore.value).toEqual(persisted);
        expect(readMidiDocument(peer)).toEqual(persisted);
    });

    it('preserves persisted arrangement sections through reset, projection, and the deferred frame', () => {
        const persisted = persistedMarkerState();
        const peer = createPeer(from<RootDocument>({ markers: persisted }));
        configureAutomergeStoragePort(peer.port);

        resetModuleStoresToDefault({
            resetGrooveTemplates: false,
            resetMidiState: false,
            resetYeastState: false,
        });
        projectCrdtToStores({ resetProjections: true });

        while (frameCallbacks.length > 0) {
            frameCallbacks.shift()?.(100);
        }

        expect(markerStore.value).toEqual(persisted);
        expect(readMarkerDocument(peer)).toEqual(persisted);
    });

    it('projects the deterministic legacy default without writing a missing MIDI slot', () => {
        midiStore.set({
            probabilitySeed: 123,
            notesByClipId: { stale: [] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        flushAutomergeStorageWrites();
        const peer = createPeer(from<RootDocument>({}));
        configureAutomergeStoragePort(peer.port);
        expect(readMidiDocument(peer)).toBeUndefined();

        midiStore.hydrate();

        expect(midiStore.value).toEqual(defaultMidiState());
        expect(readMidiDocument(peer)).toBeUndefined();
    });
});
