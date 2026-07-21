import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { shouldPlayMidiEvent } from '../../useCases/shouldPlayMidiEvent';
import {
    defaultMidiStoreState,
    isValidMidiProbabilitySeed,
    LEGACY_MIDI_PROBABILITY_SEED,
    midiStore,
    type MidiStoreState,
} from '../midiStore';

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

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

function require_midi_state(): MidiStoreState {
    const state = midiStore.value;
    if (state === null) {
        throw new Error('Expected concrete MIDI store state');
    }
    return state;
}

async function flush_pending_frame(): Promise<void> {
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

describe('midiStore', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        midiStore.set(defaultMidiStoreState);
        await flush_pending_frame();
        clear_fake_doc();
        mutation_count = 0;
        configure_fake_crdt_port();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('should sanitize malformed CRDT hydration to an empty MIDI store without throwing', () => {
        fake_doc.midi = { notesByClipId: 'not-a-map', ccByClipId: 'not-a-map', pitchBendByClipId: 'not-a-map' };

        expect(() => {
            midiStore.hydrate();
        }).not.toThrow();

        expect(midiStore.value).toEqual(defaultMidiStoreState);
    });

    it('exposes a concrete unsigned u32 seed after default and legacy hydration', () => {
        const defaultState = require_midi_state();
        expectTypeOf(defaultState.probabilitySeed).toEqualTypeOf<number>();
        expect(isValidMidiProbabilitySeed(defaultState.probabilitySeed)).toBe(true);

        fake_doc.midi = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
        midiStore.hydrate();

        const legacyHydratedState = require_midi_state();
        expectTypeOf(legacyHydratedState.probabilitySeed).toEqualTypeOf<number>();
        expect(legacyHydratedState.probabilitySeed).toBe(LEGACY_MIDI_PROBABILITY_SEED);
        expect(isValidMidiProbabilitySeed(legacyHydratedState.probabilitySeed)).toBe(true);
    });

    it('preserves the active seed when a legacy-shaped owner write omits it', () => {
        midiStore.set({
            probabilitySeed: 3_735_928_559,
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });

        expect(require_midi_state().probabilitySeed).toBe(3_735_928_559);
    });

    it('should default malformed top-level maps independently without resetting valid siblings', () => {
        fake_doc.midi = {
            notesByClipId: 'not-a-map',
            ccByClipId: {
                'clip-cc': [{ id: 'cc-1', controller: 74, value: 0.5, beat: 1, channel: 0 }],
            },
            pitchBendByClipId: 'not-a-map',
        };

        midiStore.hydrate();

        expect(midiStore.value).toEqual({
            probabilitySeed: defaultMidiStoreState.probabilitySeed,
            notesByClipId: {},
            ccByClipId: {
                'clip-cc': [{ id: 'cc-1', controller: 74, value: 0.5, beat: 1, channel: 0 }],
            },
            pitchBendByClipId: {},
        });
    });

    it('should keep valid neighboring clip entries when malformed CRDT rows hydrate', () => {
        fake_doc.midi = {
            notesByClipId: {
                'clip-notes': [
                    { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 90 },
                    { id: 'bad-note', pitch: 'high', startBeat: 0, duration: 1, velocity: 90 },
                ],
                'clip-bad-notes': 'not-an-array',
            },
            ccByClipId: {
                'clip-cc': [
                    { id: 'cc-1', controller: 74, value: 0.5, beat: 1, channel: 0 },
                    { id: 'bad-cc', controller: 7, value: 'loud', beat: 1, channel: 0 },
                ],
                'clip-bad-cc': 'not-an-array',
            },
            pitchBendByClipId: {
                'clip-pitch': [
                    { id: 'pitch-1', value: -0.25, beat: 2, channel: 1 },
                    { id: 'bad-pitch', value: -0.25, beat: null, channel: 1 },
                ],
                'clip-bad-pitch': 'not-an-array',
            },
        };

        midiStore.hydrate();

        expect(midiStore.value).toEqual({
            probabilitySeed: defaultMidiStoreState.probabilitySeed,
            notesByClipId: {
                'clip-notes': [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
            },
            ccByClipId: {
                'clip-cc': [{ id: 'cc-1', controller: 74, value: 0.5, beat: 1, channel: 0 }],
            },
            pitchBendByClipId: {
                'clip-pitch': [{ id: 'pitch-1', value: -0.25, beat: 2, channel: 1 }],
            },
        });
    });

    it('should strip malformed optional note fields without dropping the valid parent note or clip', () => {
        fake_doc.midi = {
            notesByClipId: {
                'clip-notes': [
                    {
                        id: 'note-1',
                        pitch: 60,
                        startBeat: 0,
                        duration: 1,
                        velocity: 90,
                        probability: 'maybe',
                        pressure: 0.7,
                        slide: null,
                        pitchBend: -0.1,
                        channel: 'one',
                        stale: true,
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
            stale: true,
        };

        midiStore.hydrate();

        expect(midiStore.value).toEqual({
            probabilitySeed: defaultMidiStoreState.probabilitySeed,
            notesByClipId: {
                'clip-notes': [
                    {
                        id: 'note-1',
                        pitch: 60,
                        startBeat: 0,
                        duration: 1,
                        velocity: 90,
                        pressure: 0.7,
                        pitchBend: -0.1,
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should preserve exact valid CRDT hydration without writing back', async () => {
        const valid_state = {
            probabilitySeed: 4_294_967_295,
            notesByClipId: {
                'clip-notes': [
                    {
                        id: 'note-1',
                        pitch: 60,
                        startBeat: 0,
                        duration: 1,
                        velocity: 90,
                        probability: 75,
                        pressure: 0.7,
                        slide: -0.2,
                        pitchBend: 0.1,
                        channel: 2,
                    },
                ],
            },
            ccByClipId: {
                'clip-cc': [{ id: 'cc-1', controller: 74, value: 0.5, beat: 1, channel: 0 }],
            },
            pitchBendByClipId: {
                'clip-pitch': [{ id: 'pitch-1', value: -0.25, beat: 2, channel: 1 }],
            },
        } satisfies MidiStoreState;
        fake_doc.midi = valid_state;

        midiStore.hydrate();
        await flush_pending_frame();

        expect(midiStore.value).toEqual(valid_state);
        expect(mutation_count).toBe(0);
    });

    it('preserves the persisted unsigned u32 probability seed through CRDT hydration', () => {
        fake_doc.midi = {
            probabilitySeed: 3_735_928_559,
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        midiStore.hydrate();

        expect(midiStore.value?.probabilitySeed).toBe(3_735_928_559);
    });

    it('replays the fixed probability tuple corpus from collaborative CRDT state', () => {
        fake_doc.midi = {
            probabilitySeed: 0xdecafbad,
            notesByClipId: {
                'clip-1': [
                    { id: 'event-alpha', pitch: 60, startBeat: 1, duration: 0.25, velocity: 100, probability: 50 },
                    { id: 'event-beta', pitch: 61, startBeat: 1, duration: 0.25, velocity: 100, probability: 50 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        midiStore.hydrate();

        const acceptedIds = midiStore.value?.notesByClipId['clip-1']
            ?.filter((note) =>
                shouldPlayMidiEvent({
                    projectProbabilitySeed: midiStore.value?.probabilitySeed ?? 0,
                    clipId: 'clip-1',
                    eventId: note.id,
                    absoluteOccurrenceIndex: 0,
                    probabilityPercent: note.probability ?? 100,
                })
            )
            .map((note) => note.id);
        expect(acceptedIds).toEqual(['event-alpha']);
    });
});
