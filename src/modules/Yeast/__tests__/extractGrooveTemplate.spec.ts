import { beforeEach, describe, expect, it } from 'vitest';

import { defaultTrackState, trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { getStraightGrooveTemplateId, setMidiStoreState } from '#/modules/MIDI/useCases';

import { proposeYeastGrooveExtraction } from '../useCases/proposeYeastGrooveExtraction';

function createTrackState(clipType: 'audio' | 'midi' = 'midi'): TrackStoreState {
    return {
        tracks: [
            {
                id: 'track-source',
                name: 'Source track',
                kind: 'midi',
                muted: false,
                soloed: false,
                armed: false,
                gain: 1,
                pan: 0,
                color: '#abcdef',
                clips: [
                    {
                        id: 'clip-source',
                        trackId: 'track-source',
                        name: 'Source clip',
                        startBeat: 0,
                        endBeat: 4,
                        type: clipType,
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#abcdef',
                        locked: false,
                        muted: false,
                    },
                ],
                devices: [],
                sends: [],
                midiFx: [],
                frozen: false,
                freezeState: { status: 'unfrozen' },
                parentId: null,
                collapsed: false,
                inputMonitoring: 'auto',
                hidden: false,
                disabled: false,
                height: 80,
                outputId: 'master',
                automationMode: 'read',
                groupId: null,
                soloSafe: false,
                notes: '',
                inputId: null,
                activeAlternativeId: 'main',
                alternatives: [],
                vcaGroupId: null,
                midiOutputTrackId: null,
                followChordTrack: false,
            },
        ],
        selectedTrackId: 'track-source',
        ghostClips: [],
    };
}

describe('Yeast groove extraction', () => {
    beforeEach(() => {
        trackStore.set(createTrackState());
        setMidiStoreState({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    it('returns typed unsupported and empty results from the MIDI-owned extraction contract', () => {
        expect(proposeYeastGrooveExtraction({ clipId: 'clip-source', subdivision: '1/64' })).toEqual({
            status: 'unsupported',
            clipId: 'clip-source',
            sourceName: 'Source clip',
            subdivision: '1/64',
        });
        expect(proposeYeastGrooveExtraction({ clipId: 'clip-source', subdivision: '1/16' })).toEqual({
            status: 'empty',
            clipId: 'clip-source',
            sourceName: 'Source clip',
            subdivision: '1/16',
        });
    });

    it('distinguishes quantized Straight from an extracted shared template', () => {
        setMidiStoreState({
            notesByClipId: {
                'clip-source': [
                    { id: 'one', pitch: 60, startBeat: 0, duration: 0.25, velocity: 100 },
                    { id: 'two', pitch: 64, startBeat: 0.25, duration: 0.25, velocity: 100 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        const straight = proposeYeastGrooveExtraction({ clipId: 'clip-source', subdivision: '1/16' });
        expect(straight).toEqual(
            expect.objectContaining({ status: 'straight', clipId: 'clip-source', subdivision: '1/16' })
        );
        if (straight.status !== 'straight') {
            throw new Error('Expected Straight proposal');
        }
        expect(straight.template).toEqual(
            expect.objectContaining({ id: getStraightGrooveTemplateId(), name: 'Straight' })
        );

        setMidiStoreState({
            notesByClipId: {
                'clip-source': [{ id: 'late', pitch: 60, startBeat: 0.02, duration: 0.25, velocity: 96 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        const extracted = proposeYeastGrooveExtraction({ clipId: 'clip-source', subdivision: '1/16' });
        expect(extracted).toEqual(
            expect.objectContaining({ status: 'extracted', clipId: 'clip-source', subdivision: '1/16' })
        );
        if (extracted.status !== 'extracted') {
            throw new Error('Expected extracted proposal');
        }
        expect(extracted.template).toEqual(
            expect.objectContaining({
                id: 'groove-clip-source-v1',
                name: 'Source clip groove',
                provenance: { type: 'midi-clip', sourceId: 'clip-source', analyzerVersion: 1 },
            })
        );
    });

    it('rejects missing and non-MIDI Arrangement clips before reading MIDI notes', () => {
        trackStore.set(createTrackState('audio'));

        expect(proposeYeastGrooveExtraction({ clipId: 'clip-source', subdivision: '1/16' })).toEqual({
            status: 'ineligible-clip',
            clipId: 'clip-source',
        });
        expect(proposeYeastGrooveExtraction({ clipId: 'missing', subdivision: '1/16' })).toEqual({
            status: 'ineligible-clip',
            clipId: 'missing',
        });

        trackStore.set(structuredClone(defaultTrackState));
    });
});
