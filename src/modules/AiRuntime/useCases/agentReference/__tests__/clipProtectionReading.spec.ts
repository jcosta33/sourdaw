import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import { clipProtectionReading } from '../clipProtectionReading';

const leadPart = {
    id: 'clip-lead-part',
    name: 'Lead Part',
    type: 'audio' as const,
    startBeat: 0,
    endBeat: 8,
    noteCount: 0,
    locked: false,
};

const keys: ProjectContextTrack = {
    id: 'track-keys',
    name: 'Keys',
    kind: 'audio',
    muted: false,
    soloed: false,
    soloSafe: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    automationMode: 'read',
    clipCount: 1,
    deviceCount: 0,
    clips: [leadPart],
    devices: [],
};

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [keys],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

describe('clipProtectionReading.namesClip', () => {
    it.each([
        ['keep the Missing clip punchy', true],
        ['keep the Missing Clip punchy', true],
        ['leave the clips alone', true],
        ['keep the Lead Part unchanged', true],
        ['keep the lead part punchy', true],
        ['keep "Clip Art" punchy', false],
        ['keep the "Missing clip" punchy', false],
        ['keep the Kick level punchy', false],
        ['keep the clipping down', false],
    ])('reads "%s" as naming a clip: %s', (text, expected) => {
        expect(clipProtectionReading.namesClip(text, context)).toBe(expected);
    });
});
