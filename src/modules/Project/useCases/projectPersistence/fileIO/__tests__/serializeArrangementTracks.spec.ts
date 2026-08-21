import { describe, it, expect } from 'vitest';

import { normalizeTrack } from '#/modules/Arrangement/useCases';

import { hydrateArrangementTracks } from '../hydrateArrangementTracks';
import { serializeArrangementTracks } from '../serializeArrangementTracks';

describe('serializeArrangementTracks (clip-shape mapping)', () => {
    it('maps the runtime audioBufferId onto the serialized bufferId', () => {
        const track = normalizeTrack({
            id: 'track-1',
            name: 'Audio',
            kind: 'audio',
            clips: [
                {
                    id: 'clip-1',
                    trackId: 'track-1',
                    name: 'take',
                    startBeat: 0,
                    endBeat: 4,
                    type: 'audio',
                    audioBufferId: 'buf-abc',
                    audioOffsetBeats: 2,
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    gain: 1,
                    color: '#fff',
                    locked: false,
                    muted: false,
                },
            ],
        });

        const [serialized] = serializeArrangementTracks([track]);
        const clip = serialized?.clips[0];

        expect(clip?.bufferId).toBe('buf-abc');
        expect(clip?.sampleStartBeat).toBe(2);
        // The runtime field name must not leak into the serialized shape.
        expect((clip as Record<string, unknown>).audioBufferId).toBeUndefined();
    });

    it('leaves bufferId undefined for a MIDI clip with no audio buffer', () => {
        const track = normalizeTrack({
            id: 'track-2',
            name: 'MIDI',
            kind: 'midi',
            clips: [
                {
                    id: 'clip-2',
                    trackId: 'track-2',
                    name: 'pattern',
                    startBeat: 0,
                    endBeat: 8,
                    type: 'midi',
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    gain: 1,
                    color: '#fff',
                    locked: false,
                    muted: false,
                },
            ],
        });

        const [serialized] = serializeArrangementTracks([track]);
        expect(serialized?.clips[0]?.bufferId).toBeUndefined();
    });

    it('folds MIDI-store notes inline onto the clip during serialization', () => {
        const track = normalizeTrack({
            id: 'track-3',
            name: 'MIDI',
            kind: 'midi',
            clips: [
                {
                    id: 'clip-3',
                    trackId: 'track-3',
                    name: 'pattern',
                    startBeat: 0,
                    endBeat: 8,
                    type: 'midi',
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    gain: 1,
                    color: '#fff',
                    locked: false,
                    muted: false,
                },
            ],
        });

        const notesByClipId = {
            'clip-3': [
                { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                { id: 'note-2', pitch: 64, startBeat: 1, duration: 1, velocity: 90 },
            ],
        };

        const [serialized] = serializeArrangementTracks([track], notesByClipId);
        const notes = serialized?.clips[0]?.notes;

        expect(notes).toHaveLength(2);
        expect(notes?.[0]?.pitch).toBe(60);
        // Optional runtime fields are filled with deterministic defaults.
        expect(notes?.[0]?.probability).toBe(100);
        expect(notes?.[0]?.pressure).toBe(0);
    });

    it('maps clips inside track alternatives, not only the active clip list', () => {
        const track = normalizeTrack({
            id: 'track-4',
            name: 'Audio',
            kind: 'audio',
            clips: [],
            alternatives: [
                {
                    id: 'alt-1',
                    name: 'Alt',
                    clips: [
                        {
                            id: 'clip-4',
                            trackId: 'track-4',
                            name: 'alt-take',
                            startBeat: 0,
                            endBeat: 4,
                            type: 'audio',
                            audioBufferId: 'buf-alt',
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '#fff',
                            locked: false,
                            muted: false,
                        },
                    ],
                },
            ],
        });

        const [serialized] = serializeArrangementTracks([track]);
        expect(serialized?.alternatives[0]?.clips[0]?.bufferId).toBe('buf-alt');
    });

    it('serializes clip fileId and preserves it across serialization and hydration round-trip', () => {
        const track = normalizeTrack({
            id: 'track-5',
            name: 'Vocal',
            kind: 'audio',
            clips: [
                {
                    id: 'clip-5',
                    trackId: 'track-5',
                    name: 'lead-vocal',
                    startBeat: 0,
                    endBeat: 8,
                    type: 'audio',
                    audioBufferId: 'buf-vocal',
                    fileId: '/projects/audio/lead_pitch.wav',
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    gain: 1,
                    color: '#fff',
                    locked: false,
                    muted: false,
                },
            ],
        });

        const [serialized] = serializeArrangementTracks([track]);
        expect(serialized).toBeDefined();
        if (!serialized) {
            throw new Error('serialized track is undefined');
        }
        expect(serialized.clips[0]?.fileId).toBe('/projects/audio/lead_pitch.wav');

        const [hydrated] = hydrateArrangementTracks([serialized]);
        expect(hydrated?.clips[0]?.fileId).toBe('/projects/audio/lead_pitch.wav');
    });
});
