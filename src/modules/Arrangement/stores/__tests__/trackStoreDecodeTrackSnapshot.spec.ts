import { describe, expect, it } from 'vitest';

import { decodeTrackSnapshot, sanitizeTrackSnapshot, type Clip, type Track } from '../trackStore';

const audioClip: Clip = {
    id: 'clip-audio',
    trackId: 'track-full',
    name: 'Vocal',
    startBeat: 4,
    endBeat: 12,
    type: 'audio',
    audioBufferId: 'buffer-1',
    fileId: 'file-1',
    assetHash: 'sha-1',
    audioOffsetBeats: 0.5,
    audioOffsetSeconds: -0.25,
    audioUnwrappedOffsetSeconds: 1.5,
    audioLoopStartSeconds: 0.75,
    audioLoopPassEntrySeconds: 0.125,
    audioLoopPassOriginBeat: 2,
    fadeInBeats: 0.25,
    fadeOutBeats: 0.5,
    gain: 0.7,
    color: '#123456',
    locked: true,
    muted: true,
    stretchMode: 'timestretch',
    stretchRatio: 1.25,
    loopEnabled: true,
    loopLength: 4,
    loopOriginBeat: 1,
    followAction: 'play_next',
    generating: false,
    isGhost: false,
    isInlineEditing: true,
    parentClipId: 'clip-parent',
    isLinkedInstance: true,
    sourceKeyRoot: 3,
    sourceScaleName: 'minor',
    overrides: { gain: true },
    kneadState: {
        blobs: [
            {
                id: 'blob-1',
                startTime: 0.1,
                endTime: 0.4,
                pitchCenterCents: 6900,
                originalPitchCenterCents: 6880,
                pitchCurveCents: [6890, 6900, 6910],
                voicedConfidence: 0.9,
            },
        ],
        retuneSpeedMs: 20,
        humanizePercent: 10,
        formantPreserve: true,
    },
};

const zeroLengthClip: Clip = {
    id: 'clip-zero',
    trackId: 'track-full',
    name: 'Zero',
    startBeat: 16,
    endBeat: 16,
    type: 'midi',
    midiOffsetBeats: 0.5,
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '',
    locked: false,
    muted: false,
};

const preRollClip: Clip = { ...zeroLengthClip, id: 'clip-pre-roll', name: 'Pre-roll', startBeat: -2, endBeat: 1 };

const fullTrack: Track = {
    id: 'track-full',
    name: 'Full',
    kind: 'audio',
    muted: true,
    soloed: true,
    armed: true,
    gain: 0.6,
    pan: -0.3,
    color: '#abcdef',
    clips: [audioClip, zeroLengthClip, preRollClip],
    devices: [
        {
            id: 'device-1',
            name: 'Reverb',
            type: 'reverb',
            bypassed: true,
            parameterValues: { mix: 0.4 },
            externalPluginId: 'plugin-1',
            externalInstanceId: 'instance-1',
            externalStateChunk: 'chunk',
            deviceState: { version: 2, data: { pads: [1, 'two', true], cleared: null, nested: { level: 3 } } },
        },
    ],
    sends: [{ busId: 'bus-1', level: 0.5, preFader: true }],
    midiFx: [{ id: 'fx-1', name: 'Arp', type: 'arp', bypassed: true, parameterValues: { rate: 4 } }],
    frozen: true,
    frozenBufferId: 'frozen-buffer',
    freezeState: {
        status: 'frozen',
        freezeId: 'freeze-1',
        frozenBufferId: 'frozen-buffer',
        frozenAudioHash: 'audio-hash',
        sourceContentHash: 'source-hash',
        deviceChainHash: 'chain-hash',
        renderSettings: { sampleRate: 48000, bitDepth: 32, channelCount: 2, tailLengthSeconds: 2, bakeVersion: 1 },
        compensationSeconds: 0.01,
        renderProgress: 1,
        renderedAt: 1700000000000,
    },
    parentId: 'folder-1',
    collapsed: true,
    inputMonitoring: 'on',
    hidden: true,
    disabled: true,
    height: 120,
    outputId: 'bus-1',
    automationMode: 'touch',
    groupId: 'group-1',
    soloSafe: true,
    notes: 'notes',
    inputId: 'input-1',
    activeAlternativeId: 'alt-a',
    alternatives: [
        { id: 'alt-a', name: 'A', clips: [audioClip] },
        { id: 'alt-b', name: 'B', clips: [zeroLengthClip, preRollClip] },
    ],
    vcaGroupId: 'vca-1',
    midiOutputTrackId: 'track-midi',
    followChordTrack: true,
    showVariationLanes: true,
};

describe('decodeTrackSnapshot', () => {
    it('decodes a structured clone of a fully populated store row to an equal row', () => {
        const storeRow = sanitizeTrackSnapshot({ tracks: [fullTrack], selectedTrackId: null }).tracks[0];

        // The fixture is a row the store itself would hold, so nothing in it was dropped.
        expect(storeRow).toStrictEqual(fullTrack);
        expect(decodeTrackSnapshot(structuredClone(storeRow))).toStrictEqual(fullTrack);
    });

    it('decodes a minimal store row without gaining or losing fields', () => {
        const storeRow = sanitizeTrackSnapshot({
            tracks: [{ id: 'track-min', name: 'Minimal', kind: 'bus' }],
            selectedTrackId: null,
        }).tracks[0];

        expect(storeRow).toBeDefined();
        expect(decodeTrackSnapshot(structuredClone(storeRow))).toStrictEqual(storeRow);
    });

    it.each([
        ['null', null],
        ['an array', [fullTrack]],
        ['a row without an id', { ...fullTrack, id: undefined }],
        ['a row without a kind', { ...fullTrack, kind: undefined }],
        ['a row with an unknown kind', { ...fullTrack, kind: 'video' }],
    ])('refuses %s', (_label, value) => {
        expect(decodeTrackSnapshot(value)).toBeNull();
    });
});
