import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { defaultMidiStoreState, midiStore, type MidiStoreState } from '../midiStore';

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
});
