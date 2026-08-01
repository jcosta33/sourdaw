import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../bridgeGroundedLlmToolCalls';

type ProjectTrack = ProjectContext['tracks'][number];
type CreateTrackInput = {
    id: string;
    name: string;
    kind?: ProjectTrack['kind'];
    devices?: ProjectTrack['devices'];
};

function createTrack({ id, name, kind = 'audio', devices = [] }: CreateTrackInput): ProjectTrack {
    return {
        id,
        name,
        kind,
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        outputId: kind === 'master' ? 'hw_out' : 'master',
        clipCount: 0,
        deviceCount: devices.length,
        clips: [],
        devices,
        sends: [],
    };
}

const vocals = createTrack({
    id: 'track-vocals',
    name: 'Vocals',
    devices: [{ id: 'device-eq', type: 'EQ', bypassed: false, parameters: [] }],
});
const guitar = createTrack({ id: 'track-guitar', name: 'Guitar' });
const master = createTrack({ id: 'master', name: 'Master', kind: 'master' });
const projectContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isLooping: true,
    loopStart: 4,
    loopEnd: 12,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    automationLanes: [
        {
            id: 'lane-vocal-gain',
            trackId: 'track-vocals',
            parameterId: 'gain',
            name: 'Gain',
            enabled: true,
            minValue: 0,
            maxValue: 1,
            points: [],
        },
    ],
    tracks: [vocals, guitar, master],
    selectedTrackId: 'track-vocals',
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

function bridge(
    calls: Parameters<typeof bridgeGroundedLlmToolCalls>[0]['calls'],
    prompt: string,
    context = projectContext
) {
    return bridgeGroundedLlmToolCalls({ calls, prompt, context });
}

function createClipContext(): ProjectContext {
    const intro = {
        id: 'clip-intro',
        name: 'Intro',
        type: 'audio' as const,
        startBeat: 0,
        endBeat: 8,
        gain: 1,
        locked: false,
        noteCount: 0,
    };
    const chorus = { ...intro, id: 'clip-chorus', name: 'Chorus', startBeat: 8, endBeat: 16 };
    const vocalsVerse = { ...intro, id: 'clip-vocals-verse', name: 'Verse', startBeat: 16, endBeat: 24 };
    const guitarVerse = { ...intro, id: 'clip-guitar-verse', name: 'Verse', startBeat: 24, endBeat: 32 };
    const deviceCollision = { ...intro, id: 'clip-eq', name: 'EQ', startBeat: 32, endBeat: 40 };
    const entityTie = { ...intro, id: 'clip-bridge', name: 'Bridge', startBeat: 40, endBeat: 48 };
    const trackCollision = createTrack({ id: 'track-verse', name: 'Verse' });
    const entityTieTrack = createTrack({ id: 'track-bridge', name: 'Bridge' });
    return {
        ...projectContext,
        tracks: [
            { ...vocals, clipCount: 5, clips: [intro, chorus, vocalsVerse, deviceCollision, entityTie] },
            { ...guitar, clipCount: 1, clips: [guitarVerse] },
            trackCollision,
            entityTieTrack,
            master,
        ],
        selectedClipId: intro.id,
        selectedClipIds: [intro.id],
    };
}

function createMidiClipContext(): ProjectContext {
    const context = createClipContext();
    const sourceTrack = context.tracks.find((track) => track.id === 'track-vocals');
    const sourceClip = sourceTrack?.clips[0];
    if (!sourceTrack || !sourceClip) {
        throw new Error('Expected clip fixtures');
    }
    const midiClip = {
        ...sourceClip,
        id: 'clip-midi',
        name: 'Piano MIDI',
        type: 'midi' as const,
        noteCount: 4,
    };
    return {
        ...context,
        tracks: context.tracks.map((track) =>
            track.id === sourceTrack.id ? { ...track, clipCount: 1, clips: [midiClip] } : track
        ),
        selectedClipId: midiClip.id,
        selectedClipIds: [midiClip.id],
    };
}

describe('bridgeGroundedLlmToolCalls', () => {
    it('grounds whole-clip MIDI transforms and rejects selected-note or mismatched values', () => {
        const context = createMidiClipContext();
        const quantize = bridge(
            [{ name: 'quantizeNotes', arguments: { clipId: 'clip-midi', gridSize: 0.25 } }],
            'quantize notes in Piano MIDI to a 0.25 beat grid',
            context
        );
        const transpose = bridge(
            [{ name: 'transposeNotes', arguments: { clipId: 'clip-midi', semitones: -7 } }],
            'transpose notes in Piano MIDI by -7 semitones',
            context
        );
        const selectedNotes = bridge(
            [{ name: 'transposeNotes', arguments: { clipId: 'clip-midi', semitones: 7 } }],
            'transpose notes in Piano MIDI by 7 semitones, but only the selected notes',
            context
        );
        const wrongValue = bridge(
            [{ name: 'quantizeNotes', arguments: { clipId: 'clip-midi', gridSize: 0.5 } }],
            'quantize notes in Piano MIDI to a 0.25 beat grid',
            context
        );
        const audioTarget = bridge(
            [{ name: 'transposeNotes', arguments: { clipId: 'clip-intro', semitones: 7 } }],
            'transpose notes in Intro by 7 semitones',
            createClipContext()
        );

        expect(quantize.actions).toEqual([{ type: 'quantizeNotes', payload: { clipId: 'clip-midi', gridSize: 0.25 } }]);
        expect(transpose.actions).toEqual([
            { type: 'transposeNotes', payload: { clipId: 'clip-midi', semitones: -7 } },
        ]);
        expect(selectedNotes.actions).toEqual([]);
        expect(selectedNotes.rejections[0]?.reason).toContain('Selected-note edits are not supported');
        expect(wrongValue.actions).toEqual([]);
        expect(wrongValue.rejections[0]?.reason).toContain('does not match');
        expect(audioTarget.actions).toEqual([]);
        expect(audioTarget.rejections[0]?.reason).toContain('not grounded');
    });

    it('grounds multiple distinct targets from one provider plan', () => {
        const result = bridge(
            [
                { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                { name: 'setTrackPan', arguments: { trackId: 'track-guitar', pan: -20 } },
            ],
            'mute Vocals and pan Guitar'
        );
        const swapped = bridge(
            [
                { name: 'muteTrack', arguments: { trackId: 'track-guitar', muted: true } },
                { name: 'setTrackPan', arguments: { trackId: 'track-vocals', pan: -20 } },
            ],
            'mute Vocals and pan Guitar'
        );
        const repeated = bridge(
            [
                { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                { name: 'muteTrack', arguments: { trackId: 'track-guitar', muted: true } },
            ],
            'mute Vocals and mute Guitar'
        );

        expect(result.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } },
            { type: 'setTrackPan', payload: { trackId: 'track-guitar', pan: -20 } },
        ]);
        expect(result.rejections).toEqual([]);
        expect(swapped.actions).toEqual([]);
        expect(repeated.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } },
            { type: 'muteTrack', payload: { trackId: 'track-guitar', muted: true } },
        ]);
    });

    it('rejects ambiguous, mismatched, and ungrounded provider targets', () => {
        const ambiguousContext = {
            ...projectContext,
            tracks: [...projectContext.tracks, { ...vocals, id: 'track-vocals-double' }],
        };
        const ambiguous = bridge(
            [{ name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } }],
            'mute Vocals',
            ambiguousContext
        );
        const mismatched = bridge(
            [{ name: 'muteTrack', arguments: { trackId: 'track-guitar', muted: true } }],
            'mute Vocals'
        );
        const ungrounded = bridge(
            [{ name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } }],
            'make it quieter'
        );
        const wrongAction = bridge(
            [{ name: 'soloTrack', arguments: { trackId: 'track-vocals', soloed: true } }],
            'mute Vocals'
        );
        const center = createTrack({ id: 'track-center', name: 'Center' });
        const entityActionCollision = bridge(
            [{ name: 'setTrackPan', arguments: { trackId: center.id, pan: 0 } }],
            'mute Center',
            { ...projectContext, tracks: [...projectContext.tracks, center] }
        );

        expect(ambiguous.rejections[0]?.reason).toContain('ambiguous');
        expect(mismatched.rejections[0]?.reason).toContain('does not match');
        expect(ungrounded.rejections[0]?.reason).toContain('not grounded');
        expect(wrongAction.actions).toEqual([]);
        expect(entityActionCollision.actions).toEqual([]);
    });

    it('grounds targetless intent, discrete polarity, and literal rename values', () => {
        const valid = bridge(
            [
                { name: 'setTempo', arguments: { bpm: 128 } },
                { name: 'muteTrack', arguments: { trackId: vocals.id, muted: false } },
                { name: 'renameTrack', arguments: { trackId: guitar.id, name: 'Solo' } },
            ],
            'set tempo to 128 and unmute Vocals and rename Guitar to Solo'
        );
        const hallucinatedTargetless = bridge(
            [{ name: 'addTrack', arguments: { name: 'Drums', kind: 'audio' } }],
            'mute Vocals'
        );
        const negated = bridge(
            [{ name: 'muteTrack', arguments: { trackId: vocals.id, muted: true } }],
            'do not mute Vocals'
        );
        const wrongPolarity = bridge(
            [{ name: 'muteTrack', arguments: { trackId: vocals.id, muted: true } }],
            'unmute Vocals'
        );
        const wrongRename = bridge(
            [{ name: 'renameTrack', arguments: { trackId: vocals.id, name: 'Drums' } }],
            'rename Vocals to Lead'
        );
        const specificIntent = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, gain: 0.7 } }],
            'increase volume to 70% on Vocals'
        );
        const wrongTempo = bridge([{ name: 'setTempo', arguments: { bpm: 300 } }], 'set tempo to 120');
        const wrongColor = bridge(
            [{ name: 'setTrackColor', arguments: { trackId: vocals.id, color: '#ff0000' } }],
            'color Vocals #00ff00'
        );
        const wrongCreatedTrack = bridge(
            [{ name: 'addTrack', arguments: { name: 'Bass', kind: 'midi' } }],
            'create an audio track named Drums'
        );
        const createdBus = bridge(
            [{ name: 'createBus', arguments: { name: 'Parallel Reverb' } }],
            'create a bus called Parallel Reverb'
        );
        const wrongCreatedBus = bridge(
            [{ name: 'createBus', arguments: { name: 'Drum Crush' } }],
            'create a bus called Parallel Reverb'
        );

        expect(valid.actions).toEqual([
            { type: 'setTempo', payload: { bpm: 128 } },
            { type: 'muteTrack', payload: { trackId: vocals.id, muted: false } },
            { type: 'renameTrack', payload: { trackId: guitar.id, name: 'Solo' } },
        ]);
        expect(hallucinatedTargetless.actions).toEqual([]);
        expect(negated.actions).toEqual([]);
        expect(wrongPolarity.actions).toEqual([]);
        expect(wrongRename.actions).toEqual([]);
        expect(specificIntent.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, gain: 0.7 } }]);
        expect(wrongTempo.actions).toEqual([]);
        expect(wrongColor.actions).toEqual([]);
        expect(wrongCreatedTrack.actions).toEqual([]);
        expect(createdBus.actions).toEqual([{ type: 'createBus', payload: { name: 'Parallel Reverb' } }]);
        expect(wrongCreatedBus.actions).toEqual([]);
    });

    it('grounds explicit loop and metronome intent, values, and percentage normalization', () => {
        const enableLoop = bridge([{ name: 'setLoopEnabled', arguments: { enabled: true } }], 'enable looping');
        const disableLoop = bridge([{ name: 'setLoopEnabled', arguments: { enabled: false } }], 'disable looping');
        const loopRegion = bridge(
            [{ name: 'setLoopRegion', arguments: { startBeat: 8, endBeat: 16 } }],
            'set the loop from beat 8 to beat 16'
        );
        const regionAndEnable = bridge(
            [
                { name: 'setLoopEnabled', arguments: { enabled: true } },
                { name: 'setLoopRegion', arguments: { startBeat: 8, endBeat: 16 } },
            ],
            'set the loop from beat 8 to beat 16 and enable looping',
            { ...projectContext, loopStart: 0, loopEnd: 0, isLooping: false }
        );
        const incompleteCompoundLoop = bridge(
            [{ name: 'setLoopRegion', arguments: { startBeat: 8, endBeat: 16 } }],
            'set the loop from beat 8 to beat 16 and enable looping'
        );
        const enableMetronome = bridge(
            [{ name: 'setMetronomeEnabled', arguments: { enabled: true } }],
            'enable the metronome'
        );
        const disableMetronome = bridge(
            [{ name: 'setMetronomeEnabled', arguments: { enabled: false } }],
            'disable the metronome'
        );
        const percentageVolume = bridge(
            [{ name: 'setMetronomeVolume', arguments: { volume: 0.25 } }],
            'set metronome volume to 25%'
        );
        const absoluteVolume = bridge(
            [{ name: 'setMetronomeVolume', arguments: { volume: 0.25 } }],
            'set metronome volume to 0.25'
        );
        const unnormalizedPercentage = bridge(
            [{ name: 'setMetronomeVolume', arguments: { volume: 25 } }],
            'set metronome volume to 25%'
        );
        const wrongRegion = bridge(
            [{ name: 'setLoopRegion', arguments: { startBeat: 4, endBeat: 12 } }],
            'set the loop from beat 8 to beat 16'
        );
        const contradictedRegion = bridge(
            [{ name: 'setLoopRegion', arguments: { startBeat: 8, endBeat: 16 } }],
            'set the loop from beat 8 to beat 16 and do not enable looping'
        );
        const explicitlyDisabledRegion = bridge(
            [{ name: 'setLoopRegion', arguments: { startBeat: 8, endBeat: 16 } }],
            'set the loop from beat 8 to beat 16 and disable looping'
        );
        const articleContradiction = bridge(
            [{ name: 'setLoopRegion', arguments: { startBeat: 8, endBeat: 16 } }],
            'set the loop from beat 8 to beat 16 and do not enable the loop'
        );
        const independentNegation = bridge(
            [{ name: 'setLoopRegion', arguments: { startBeat: 8, endBeat: 16 } }],
            'set the loop from beat 8 to beat 16, do not disable the metronome but disable looping'
        );
        const withoutEnabling = bridge(
            [{ name: 'setLoopRegion', arguments: { startBeat: 8, endBeat: 16 } }],
            'set the loop from beat 8 to beat 16 without enabling it'
        );
        const leaveLoopOff = bridge(
            [{ name: 'setLoopRegion', arguments: { startBeat: 8, endBeat: 16 } }],
            'set the loop from beat 8 to beat 16 but leave the loop off'
        );
        const unrelatedDisabledState = bridge(
            [{ name: 'setLoopRegion', arguments: { startBeat: 8, endBeat: 16 } }],
            'set the loop from beat 8 to beat 16 but leave the metronome off'
        );
        const implicitVolume = bridge(
            [{ name: 'setMetronomeVolume', arguments: { volume: 0.25 } }],
            'turn down the metronome volume'
        );

        expect(enableLoop.actions).toEqual([{ type: 'setLoopEnabled', payload: { enabled: true } }]);
        expect(disableLoop.actions).toEqual([{ type: 'setLoopEnabled', payload: { enabled: false } }]);
        const regionAction = { type: 'setLoopRegion', payload: { startBeat: 8, endBeat: 16 } } as const;
        expect(loopRegion.actions).toEqual([regionAction]);
        expect(regionAndEnable.actions).toEqual([regionAction, { type: 'setLoopEnabled', payload: { enabled: true } }]);
        expect(incompleteCompoundLoop.actions).toEqual([]);
        expect(enableMetronome.actions).toEqual([{ type: 'setMetronomeEnabled', payload: { enabled: true } }]);
        expect(disableMetronome.actions).toEqual([{ type: 'setMetronomeEnabled', payload: { enabled: false } }]);
        expect(percentageVolume.actions).toEqual([{ type: 'setMetronomeVolume', payload: { volume: 0.25 } }]);
        expect(absoluteVolume.actions).toEqual([{ type: 'setMetronomeVolume', payload: { volume: 0.25 } }]);
        expect(unnormalizedPercentage.actions).toEqual([]);
        expect(wrongRegion.actions).toEqual([]);
        expect(explicitlyDisabledRegion.actions).toEqual([]);
        expect(independentNegation.actions).toEqual([]);
        for (const result of [
            contradictedRegion,
            articleContradiction,
            withoutEnabling,
            leaveLoopOff,
            unrelatedDisabledState,
        ]) {
            expect.soft(result.actions).toEqual([regionAction]);
        }
        expect(implicitVolume.actions).toEqual([]);
    });

    it('grounds arm polarity to eligible named or selected tracks and respects cancellation', () => {
        const arm = bridge([{ name: 'armTrack', arguments: { trackId: vocals.id, armed: true } }], 'arm Vocals');
        const disarm = bridge([{ name: 'armTrack', arguments: { trackId: vocals.id, armed: false } }], 'disarm Vocals');
        const selected = bridge(
            [{ name: 'armTrack', arguments: { trackId: vocals.id, armed: true } }],
            'arm selected track'
        );
        const wrongPolarity = bridge(
            [{ name: 'armTrack', arguments: { trackId: vocals.id, armed: true } }],
            'disarm Vocals'
        );
        const cancelled = bridge(
            [{ name: 'armTrack', arguments: { trackId: vocals.id, armed: true } }],
            "arm Vocals, but don't apply it"
        );
        const vca = createTrack({ id: 'vca-drums', name: 'Drum VCA', kind: 'vca' });
        const ineligible = bridge([{ name: 'armTrack', arguments: { trackId: vca.id, armed: true } }], 'arm Drum VCA', {
            ...projectContext,
            tracks: [...projectContext.tracks, vca],
        });

        expect(arm.actions).toEqual([{ type: 'armTrack', payload: { trackId: vocals.id, armed: true } }]);
        expect(disarm.actions).toEqual([{ type: 'armTrack', payload: { trackId: vocals.id, armed: false } }]);
        expect(selected.actions).toEqual([{ type: 'armTrack', payload: { trackId: vocals.id, armed: true } }]);
        expect(wrongPolarity.actions).toEqual([]);
        expect(cancelled.actions).toEqual([]);
        expect(ineligible.actions).toEqual([]);
    });

    it('grounds destructive deletion only to an explicit non-master track target', () => {
        const named = bridge([{ name: 'removeTrack', arguments: { trackId: vocals.id } }], 'delete Vocals');
        const selected = bridge([{ name: 'removeTrack', arguments: { trackId: vocals.id } }], 'remove selected track');
        const qualifiedSelection = bridge(
            [{ name: 'removeTrack', arguments: { trackId: vocals.id } }],
            'delete selected audio track'
        );
        const mismatched = bridge([{ name: 'removeTrack', arguments: { trackId: guitar.id } }], 'delete Vocals');
        const protectedMaster = bridge([{ name: 'removeTrack', arguments: { trackId: master.id } }], 'delete Master');
        const negated = bridge([{ name: 'removeTrack', arguments: { trackId: vocals.id } }], 'do not delete Vocals');
        const deviceByName = bridge([{ name: 'removeTrack', arguments: { trackId: vocals.id } }], 'remove Vocals EQ');
        const deviceByDescription = bridge(
            [{ name: 'removeTrack', arguments: { trackId: vocals.id } }],
            'remove the Vocals compressor'
        );
        const crossIntent = bridge(
            [{ name: 'removeTrack', arguments: { trackId: vocals.id } }],
            'remove the compressor from Vocals'
        );
        const masterNamedBus = createTrack({ id: 'bus-master-name', name: 'Master', kind: 'bus' });
        const duplicateMasterNameContext = {
            ...projectContext,
            tracks: [...projectContext.tracks, masterNamedBus],
            selectedTrackId: masterNamedBus.id,
        };
        const ambiguousMasterName = bridge(
            [{ name: 'removeTrack', arguments: { trackId: masterNamedBus.id } }],
            'delete Master',
            duplicateMasterNameContext
        );
        const selectedMasterNamedBus = bridge(
            [{ name: 'removeTrack', arguments: { trackId: masterNamedBus.id } }],
            'delete selected bus track',
            duplicateMasterNameContext
        );

        expect(named.actions).toEqual([{ type: 'removeTrack', payload: { trackId: vocals.id } }]);
        expect(selected.actions).toEqual([{ type: 'removeTrack', payload: { trackId: vocals.id } }]);
        expect(qualifiedSelection.actions).toEqual([{ type: 'removeTrack', payload: { trackId: vocals.id } }]);
        expect(mismatched.actions).toEqual([]);
        expect(protectedMaster.actions).toEqual([]);
        expect(negated.actions).toEqual([]);
        expect(deviceByName.actions).toEqual([]);
        expect(deviceByDescription.actions).toEqual([]);
        expect(crossIntent.actions).toEqual([]);
        expect(ambiguousMasterName.actions).toEqual([]);
        expect(selectedMasterNamedBus.actions).toEqual([
            { type: 'removeTrack', payload: { trackId: masterNamedBus.id } },
        ]);
    });

    it('grounds time signatures as an explicit paired value', () => {
        const valid = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }],
            'set time signature to 7/8'
        );
        const fromTo = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }],
            'change the time signature from 4/4 to 7/8'
        );
        const nounQuestion = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }],
            'time signature 7/8?'
        );
        const cancelled = [
            "set time signature to 7/8, but don't apply it",
            "set time signature to 7/8, but don't actually apply it",
            "set time signature to 7/8, don't apply it",
            "set time signature to 7/8, but don't apply the change",
            'set time signature to 7/8, but cancel that',
            'set time signature to 7/8, but leave it unchanged',
            'set time signature to 7/8, on second thought',
            'set time signature to 7/8. Actually, no.',
        ].map((prompt) => bridge([{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }], prompt));
        const unrelatedNegation = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }],
            "set time signature to 7/8, but don't change the tempo"
        );
        const nearestActionNegation = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }],
            "set time signature to 7/8 and set tempo to 120, but don't apply that tempo change"
        );
        const descriptiveDistractor = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }],
            "set time signature to 7/8; mute is unrelated, but don't apply the change"
        );
        const tempoNamedTrack = createTrack({ id: 'track-tempo', name: 'Tempo' });
        const projectReferenceDistractor = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }],
            "set time signature to 7/8 for Tempo, but don't apply it",
            { ...projectContext, tracks: [...projectContext.tracks, tempoNamedTrack] }
        );
        const alternative = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }],
            'set time signature to 7/8 or 6/8'
        );
        const textualAlternative = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }],
            'set time signature to 7/8 or common time'
        );
        const chainedDestination = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 6, denominator: 8 } }],
            'set time signature to 7/8 to 6/8'
        );
        const wrongSource = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }],
            'change the time signature from 3/4 to 7/8'
        );
        const staleCurrentValue = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 4, denominator: 4 } }],
            'change the time signature currently at 4/4'
        );
        const numericNamedTrack = createTrack({ id: 'track-meter-name', name: '7/8' });
        const projectRatio = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }],
            'set the time signature for track 7/8',
            { ...projectContext, tracks: [...projectContext.tracks, numericNamedTrack] }
        );
        const unsupportedTextDestination = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 4, denominator: 4 } }],
            'change time signature from 4/4 to common time'
        );
        const unsupportedQualifiedTextDestination = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 4, denominator: 4 } }],
            'change time signature from the current 4/4 to common time'
        );
        const mismatched = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 4, denominator: 4 } }],
            'change the meter to 7/8'
        );
        const missing = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }],
            'change the time signature'
        );
        const invalid = bridge(
            [{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 3 } }],
            'set meter to 7/3'
        );
        const batch = bridge(
            [
                { name: 'setTempo', arguments: { bpm: 128 } },
                { name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } },
            ],
            'set tempo to 128 and set time signature to 7/8'
        );

        expect(valid.actions).toEqual([{ type: 'setTimeSignature', payload: { numerator: 7, denominator: 8 } }]);
        expect(fromTo.actions).toEqual([{ type: 'setTimeSignature', payload: { numerator: 7, denominator: 8 } }]);
        expect(nounQuestion.actions).toEqual([]);
        expect(cancelled.every((result) => result.actions.length === 0)).toBe(true);
        expect(unrelatedNegation.actions).toEqual([
            { type: 'setTimeSignature', payload: { numerator: 7, denominator: 8 } },
        ]);
        expect(nearestActionNegation.actions).toEqual([
            { type: 'setTimeSignature', payload: { numerator: 7, denominator: 8 } },
        ]);
        expect(descriptiveDistractor.actions).toEqual([]);
        expect(projectReferenceDistractor.actions).toEqual([]);
        expect(alternative.actions).toEqual([]);
        expect(textualAlternative.actions).toEqual([]);
        expect(chainedDestination.actions).toEqual([]);
        expect(wrongSource.actions).toEqual([]);
        expect(staleCurrentValue.actions).toEqual([]);
        expect(projectRatio.actions).toEqual([]);
        expect(unsupportedTextDestination.actions).toEqual([]);
        expect(unsupportedQualifiedTextDestination.actions).toEqual([]);
        expect(mismatched.actions).toEqual([]);
        expect(mismatched.rejections[0]?.reason).toContain('does not match');
        expect(missing.actions).toEqual([]);
        expect(missing.rejections[0]?.reason).toContain('not grounded');
        expect(invalid.actions).toEqual([]);
        expect(invalid.rejections[0]?.reason).toContain('denominator 2, 4, 8, or 16');
        expect(batch.actions).toEqual([
            { type: 'setTempo', payload: { bpm: 128 } },
            { type: 'setTimeSignature', payload: { numerator: 7, denominator: 8 } },
        ]);
    });

    it('rejects masked-control bypasses, broad creation verbs, and qualitative direction mismatches', () => {
        const referenceCollisionContext = {
            ...projectContext,
            tracks: [
                ...projectContext.tracks,
                createTrack({ id: 'track-not', name: 'Not' }),
                createTrack({ id: 'track-120', name: '120' }),
            ],
        };
        const negatedTempo = bridge(
            [{ name: 'setTempo', arguments: { bpm: 120 } }],
            'do not set tempo to 120',
            referenceCollisionContext
        );
        const wrongTempo = bridge(
            [{ name: 'setTempo', arguments: { bpm: 300 } }],
            'set tempo to 120',
            referenceCollisionContext
        );
        const broadCreation = bridge(
            [{ name: 'addTrack', arguments: { name: 'Reverb', kind: 'audio' } }],
            'add reverb to Vocals'
        );
        const wrongGainDirection = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, gain: 1 } }],
            'make Vocals quieter'
        );
        const validGainDirection = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, gain: 0.7 } }],
            'make Vocals quieter'
        );
        const wrongPanDirection = bridge(
            [{ name: 'setTrackPan', arguments: { trackId: guitar.id, pan: 50 } }],
            'pan Guitar left'
        );
        const explanatoryQuestion = bridge(
            [{ name: 'muteTrack', arguments: { trackId: vocals.id, muted: true } }],
            'Why did you mute Vocals?'
        );
        const hypothetical = bridge(
            [{ name: 'muteTrack', arguments: { trackId: vocals.id, muted: true } }],
            'If you mute Vocals, the mix changes'
        );
        const quoted = bridge([{ name: 'muteTrack', arguments: { trackId: vocals.id, muted: true } }], '"mute Vocals"');
        const politeCommand = bridge(
            [{ name: 'muteTrack', arguments: { trackId: vocals.id, muted: true } }],
            'Could you mute Vocals?'
        );
        const wrongFinalGain = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, gain: 0.02 } }],
            'lower Vocals from 80% to 60% over 2 bars'
        );
        const validFinalGain = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, gain: 0.6 } }],
            'lower Vocals from 80% to 60% over 2 bars'
        );

        expect(negatedTempo.actions).toEqual([]);
        expect(wrongTempo.actions).toEqual([]);
        expect(broadCreation.actions).toEqual([]);
        expect(wrongGainDirection.actions).toEqual([]);
        expect(validGainDirection.actions).toEqual([
            { type: 'setTrackGain', payload: { trackId: vocals.id, gain: 0.7 } },
        ]);
        expect(wrongPanDirection.actions).toEqual([]);
        expect(explanatoryQuestion.actions).toEqual([]);
        expect(hypothetical.actions).toEqual([]);
        expect(quoted.actions).toEqual([]);
        expect(politeCommand.actions).toEqual([{ type: 'muteTrack', payload: { trackId: vocals.id, muted: true } }]);
        expect(wrongFinalGain.actions).toEqual([]);
        expect(validFinalGain.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, gain: 0.6 } }]);
    });

    it('segments sentence-ending periods after numeric values', () => {
        const result = bridge(
            [
                { name: 'setTempo', arguments: { bpm: 120 } },
                { name: 'muteTrack', arguments: { trackId: vocals.id, muted: true } },
            ],
            'set tempo to 120. Mute Vocals.'
        );

        expect(result.actions).toEqual([
            { type: 'setTempo', payload: { bpm: 120 } },
            { type: 'muteTrack', payload: { trackId: vocals.id, muted: true } },
        ]);
    });

    it('binds selected-track references and rejects device fallback without a selection', () => {
        const selected = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-vocals', gain: 0.6 } }],
            'turn down the selected track'
        );
        const withoutSelection = bridge(
            [{ name: 'bypassDevice', arguments: { deviceId: 'device-eq', bypassed: true } }],
            'bypass EQ on the selected track',
            { ...projectContext, selectedTrackId: null }
        );
        const distractor = createTrack({ id: 'track-distractor', name: 'Track' });
        const wrongSelection = bridge(
            [{ name: 'muteTrack', arguments: { trackId: distractor.id, muted: true } }],
            'mute the selected track',
            { ...projectContext, tracks: [...projectContext.tracks, distractor] }
        );

        expect(selected.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: 'track-vocals', gain: 0.6 } }]);
        expect(withoutSelection.actions).toEqual([]);
        expect(wrongSelection.actions).toEqual([]);
    });

    it('scopes duplicate device names to a uniquely referenced owner track', () => {
        const frequency = {
            id: 'frequency',
            name: 'Frequency',
            type: 'float' as const,
            value: 1200,
            minValue: 20,
            maxValue: 20_000,
            unit: 'Hz',
        };
        const scopedContext: ProjectContext = {
            ...projectContext,
            tracks: projectContext.tracks.map((track) => {
                if (track.id === 'track-vocals') {
                    return { ...track, devices: [{ ...track.devices[0]!, parameters: [frequency] }] };
                }
                if (track.id === 'track-guitar') {
                    return {
                        ...track,
                        deviceCount: 1,
                        devices: [{ id: 'device-eq-guitar', type: 'EQ', bypassed: false, parameters: [frequency] }],
                    };
                }
                return track;
            }),
        };
        const bypass = bridge(
            [{ name: 'bypassDevice', arguments: { deviceId: 'device-eq', bypassed: true } }],
            'bypass EQ on Vocals',
            scopedContext
        );
        const parameter = bridge(
            [{ name: 'setDeviceParameter', arguments: { deviceId: 'device-eq', paramId: 'frequency', value: 2400 } }],
            'set EQ Frequency on Vocals',
            scopedContext
        );
        const wrongParameterDirection = bridge(
            [{ name: 'setDeviceParameter', arguments: { deviceId: 'device-eq', paramId: 'frequency', value: 1000 } }],
            'increase EQ Frequency on Vocals',
            scopedContext
        );
        const validParameterDirection = bridge(
            [{ name: 'setDeviceParameter', arguments: { deviceId: 'device-eq', paramId: 'frequency', value: 2400 } }],
            'increase EQ Frequency on Vocals',
            scopedContext
        );
        const mix = { ...frequency, id: 'mix', name: 'Mix', value: 0.5, minValue: 0, maxValue: 1, unit: '' };
        const mixTrack = createTrack({ id: 'track-mix', name: 'Mix' });
        const ownerCollisionContext: ProjectContext = {
            ...scopedContext,
            tracks: [
                ...scopedContext.tracks.map((track) => {
                    if (track.id !== vocals.id) {
                        return track;
                    }
                    return { ...track, devices: [{ ...track.devices[0]!, parameters: [frequency, mix] }] };
                }),
                mixTrack,
            ],
        };
        const ownerCollision = bridge(
            [{ name: 'setDeviceParameter', arguments: { deviceId: 'device-eq', paramId: 'mix', value: 0.5 } }],
            'set EQ Mix on Vocals',
            ownerCollisionContext
        );
        const ambiguousOwnerContext: ProjectContext = {
            ...projectContext,
            tracks: [
                { ...vocals, devices: [], deviceCount: 0 },
                { ...vocals, id: 'track-vocals-double', devices: [], deviceCount: 0 },
                {
                    ...guitar,
                    deviceCount: 1,
                    devices: [
                        {
                            id: 'device-eq-guitar',
                            type: 'EQ',
                            bypassed: false,
                            parameters: [frequency],
                        },
                    ],
                },
                master,
            ],
        };
        const wrongOwner = bridge(
            [{ name: 'bypassDevice', arguments: { deviceId: 'device-eq-guitar', bypassed: true } }],
            'bypass EQ on Vocals',
            ambiguousOwnerContext
        );

        expect(bypass.actions).toEqual([{ type: 'bypassDevice', payload: { deviceId: 'device-eq', bypassed: true } }]);
        expect(parameter.actions).toEqual([
            { type: 'setDeviceParameter', payload: { deviceId: 'device-eq', paramId: 'frequency', value: 2400 } },
        ]);
        expect(wrongParameterDirection.actions).toEqual([]);
        expect(validParameterDirection.actions).toEqual([
            { type: 'setDeviceParameter', payload: { deviceId: 'device-eq', paramId: 'frequency', value: 2400 } },
        ]);
        expect(ownerCollision.actions).toEqual([
            { type: 'setDeviceParameter', payload: { deviceId: 'device-eq', paramId: 'mix', value: 0.5 } },
        ]);
        expect(wrongOwner.actions).toEqual([]);
    });

    it('grounds catalog device insertion and destructive removal to explicit project references', () => {
        const context = {
            ...projectContext,
            availableDeviceTypes: [
                { id: 'builtin-eq', name: 'EQ' },
                { id: 'builtin-compressor', name: 'Compressor' },
            ],
        };
        const insertion = bridge(
            [{ name: 'addDevice', arguments: { trackId: vocals.id, deviceType: 'builtin-compressor' } }],
            'add Compressor to Vocals',
            context
        );
        const removal = bridge(
            [{ name: 'removeDevice', arguments: { deviceId: 'device-eq' } }],
            'remove the EQ device from Vocals',
            context
        );
        const invented = bridge(
            [{ name: 'addDevice', arguments: { trackId: vocals.id, deviceType: 'Limiter' } }],
            'add Limiter to Vocals',
            context
        );
        const mismatchedOwner = bridge(
            [{ name: 'removeDevice', arguments: { deviceId: 'device-eq' } }],
            'remove the EQ device from Guitar',
            context
        );

        expect(insertion.actions).toEqual([
            { type: 'addDevice', payload: { trackId: vocals.id, deviceType: 'builtin-compressor' } },
        ]);
        expect(removal.actions).toEqual([{ type: 'removeDevice', payload: { deviceId: 'device-eq' } }]);
        expect(invented.actions).toEqual([]);
        expect(mismatchedOwner.actions).toEqual([]);
    });

    it('reports an exact distinct-target rejection for same-endpoint routing', () => {
        const bus = createTrack({ id: 'bus-reverb', name: 'Reverb Bus', kind: 'bus' });
        const result = bridge(
            [{ name: 'setTrackOutput', arguments: { trackId: bus.id, outputId: bus.id } }],
            'route Reverb Bus to Reverb Bus',
            { ...projectContext, tracks: [...projectContext.tracks, bus] }
        );
        const drumBus = createTrack({ id: 'bus-drums', name: 'Drum Bus', kind: 'bus' });
        const reversed = bridge(
            [{ name: 'setTrackOutput', arguments: { trackId: bus.id, outputId: drumBus.id } }],
            'route Drum Bus to Reverb Bus',
            { ...projectContext, tracks: [...projectContext.tracks, bus, drumBus] }
        );
        const directionless = bridge(
            [{ name: 'setTrackOutput', arguments: { trackId: drumBus.id, outputId: bus.id } }],
            'route Drum Bus Reverb Bus',
            { ...projectContext, tracks: [...projectContext.tracks, bus, drumBus] }
        );

        expect(result.rejections[0]?.reason).toBe('Target trackId must be distinct from outputId');
        expect(reversed.actions).toEqual([]);
        expect(directionless.actions).toEqual([]);
    });

    it('preserves conjunctions and routing prepositions inside project names', () => {
        const drumsAndBass = createTrack({ id: 'track-drums-bass', name: 'Drums and Bass' });
        const backToBlack = createTrack({ id: 'track-back-black', name: 'Back to Black' });
        const context = {
            ...projectContext,
            tracks: [...projectContext.tracks, drumsAndBass, backToBlack],
        };
        const mute = bridge(
            [{ name: 'muteTrack', arguments: { trackId: drumsAndBass.id, muted: true } }],
            'mute Drums and Bass',
            context
        );
        const route = bridge(
            [{ name: 'setTrackOutput', arguments: { trackId: backToBlack.id, outputId: master.id } }],
            'route Back to Black to Master',
            context
        );

        expect(mute.actions).toEqual([{ type: 'muteTrack', payload: { trackId: drumsAndBass.id, muted: true } }]);
        expect(route.actions).toEqual([
            {
                type: 'setTrackOutput',
                payload: { trackId: backToBlack.id, outputId: master.id, expectedOutputId: master.id },
            },
        ]);
    });

    it('segments sentences and ignores negation words inside project names', () => {
        const neverEnough = createTrack({ id: 'track-never-enough', name: 'Never Enough' });
        const whyNot = createTrack({ id: 'track-why-not', name: 'Why Not' });
        const context = {
            ...projectContext,
            tracks: [...projectContext.tracks, neverEnough, whyNot],
        };
        const result = bridge(
            [
                { name: 'muteTrack', arguments: { trackId: neverEnough.id, muted: true } },
                { name: 'soloTrack', arguments: { trackId: whyNot.id, soloed: true } },
                { name: 'setTrackPan', arguments: { trackId: guitar.id, pan: -20 } },
            ],
            'Mute Never Enough.\n- Solo Why Not.\nPan Guitar 20 left.',
            context
        );

        expect(result.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: neverEnough.id, muted: true } },
            { type: 'soloTrack', payload: { trackId: whyNot.id, soloed: true } },
            { type: 'setTrackPan', payload: { trackId: guitar.id, pan: -20 } },
        ]);
    });

    it('requires Master to be phrased as an output target', () => {
        const homonym = bridge(
            [{ name: 'setTrackOutput', arguments: { trackId: 'track-vocals', outputId: 'master' } }],
            'master Vocals'
        );
        const explicit = bridge(
            [{ name: 'setTrackOutput', arguments: { trackId: 'track-vocals', outputId: 'master' } }],
            'route Vocals to Master'
        );

        expect(homonym.actions).toEqual([]);
        expect(explicit.actions).toEqual([
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-vocals', outputId: 'master', expectedOutputId: 'master' },
            },
        ]);
    });

    it('rejects oversized batches before reading project targets', () => {
        const unreadContext: ProjectContext = {
            ...projectContext,
            get tracks(): ProjectContext['tracks'] {
                throw new Error('Oversized batches must not read project targets');
            },
        };
        const result = bridge(
            Array.from({ length: 25 }, () => ({
                name: 'muteTrack',
                arguments: { trackId: 'track-vocals', muted: true },
            })),
            'mute Vocals',
            unreadContext
        );

        expect(result.rejections).toEqual([
            { index: 24, name: '<batch>', reason: 'Provider batch exceeds the 24-action limit' },
        ]);
    });

    it('grounds all eight provider clip actions to one editable clip', () => {
        const context = createClipContext();
        const cases = [
            {
                call: { name: 'duplicateClip', arguments: { clipId: 'clip-intro' } },
                prompt: 'duplicate Intro clip',
                action: { type: 'duplicateClip', payload: { clipId: 'clip-intro' } },
            },
            {
                call: { name: 'duplicateClipToNextBar', arguments: { clipId: 'clip-chorus' } },
                prompt: 'duplicate Chorus clip to next bar',
                action: { type: 'duplicateClipToNextBar', payload: { clipId: 'clip-chorus' } },
            },
            {
                call: { name: 'removeClip', arguments: { clipId: 'clip-chorus' } },
                prompt: 'delete Chorus clip',
                action: { type: 'removeClip', payload: { clipId: 'clip-chorus' } },
            },
            {
                call: { name: 'renameClip', arguments: { clipId: 'clip-intro', name: 'Opening' } },
                prompt: 'rename Intro clip to Opening',
                action: { type: 'renameClip', payload: { clipId: 'clip-intro', name: 'Opening' } },
            },
            {
                call: { name: 'trimClipStart', arguments: { clipId: 'clip-intro', newStartBeat: 2 } },
                prompt: 'trim Intro clip start to beat 2',
                action: { type: 'trimClipStart', payload: { clipId: 'clip-intro', newStartBeat: 2 } },
            },
            {
                call: { name: 'trimClipEnd', arguments: { clipId: 'clip-intro', newEndBeat: 6 } },
                prompt: 'trim Intro clip end to beat 6',
                action: { type: 'trimClipEnd', payload: { clipId: 'clip-intro', newEndBeat: 6 } },
            },
            {
                call: { name: 'nudgeClip', arguments: { clipId: 'clip-intro', beats: 2 } },
                prompt: 'nudge Intro clip by 2 beats',
                action: { type: 'nudgeClip', payload: { clipId: 'clip-intro', beats: 2 } },
            },
            {
                call: { name: 'setClipGain', arguments: { clipId: 'clip-intro', gain: 1.5 } },
                prompt: 'set Intro clip gain to 150%',
                action: { type: 'setClipGain', payload: { clipId: 'clip-intro', gain: 1.5 } },
            },
        ];

        for (const testCase of cases) {
            const result = bridge([testCase.call], testCase.prompt, context);
            expect.soft(result).toEqual({ actions: [testCase.action], rejections: [] });
        }
    });

    it('grounds duplicate clip names only with an exact track qualifier', () => {
        const context = createClipContext();
        const qualified = bridge(
            [{ name: 'renameClip', arguments: { clipId: 'clip-vocals-verse', name: 'Lead Verse' } }],
            'rename Verse on Vocals to Lead Verse',
            context
        );
        const ambiguous = bridge(
            [{ name: 'renameClip', arguments: { clipId: 'clip-vocals-verse', name: 'Lead Verse' } }],
            'rename Verse to Lead Verse',
            context
        );

        expect(qualified.actions).toEqual([
            { type: 'renameClip', payload: { clipId: 'clip-vocals-verse', name: 'Lead Verse' } },
        ]);
        expect(ambiguous.actions).toEqual([]);
    });

    it('rejects clip numeric values that mismatch or are absent from the prompt', () => {
        const context = createClipContext();
        const mismatched = [
            bridge(
                [{ name: 'trimClipStart', arguments: { clipId: 'clip-intro', newStartBeat: 3 } }],
                'trim Intro clip start to beat 2',
                context
            ),
            bridge(
                [{ name: 'trimClipEnd', arguments: { clipId: 'clip-intro', newEndBeat: 7 } }],
                'trim Intro clip end to beat 6',
                context
            ),
            bridge(
                [{ name: 'nudgeClip', arguments: { clipId: 'clip-intro', beats: 3 } }],
                'nudge Intro clip by 2 beats',
                context
            ),
            bridge(
                [{ name: 'setClipGain', arguments: { clipId: 'clip-intro', gain: 1.2 } }],
                'set Intro clip gain to 150%',
                context
            ),
        ];
        const missing = [
            bridge(
                [{ name: 'trimClipStart', arguments: { clipId: 'clip-intro', newStartBeat: 2 } }],
                'trim Intro clip start',
                context
            ),
            bridge(
                [{ name: 'trimClipEnd', arguments: { clipId: 'clip-intro', newEndBeat: 6 } }],
                'trim Intro clip end',
                context
            ),
            bridge([{ name: 'nudgeClip', arguments: { clipId: 'clip-intro', beats: 2 } }], 'nudge Intro clip', context),
            bridge(
                [{ name: 'setClipGain', arguments: { clipId: 'clip-intro', gain: 1.5 } }],
                'set Intro clip gain',
                context
            ),
        ];
        const absoluteClipGain = bridge(
            [{ name: 'setClipGain', arguments: { clipId: 'clip-intro', gain: 1.5 } }],
            'set Intro clip gain to 1.5',
            context
        );

        expect(absoluteClipGain.actions).toEqual([
            { type: 'setClipGain', payload: { clipId: 'clip-intro', gain: 1.5 } },
        ]);

        expect([...mismatched, ...missing].every((result) => result.actions.length === 0)).toBe(true);
    });

    it('rejects ambiguous selection and locked provider clip targets', () => {
        const context = createClipContext();
        const multiSelection = bridge(
            [{ name: 'nudgeClip', arguments: { clipId: 'clip-intro', beats: 2 } }],
            'nudge the selected clip by 2 beats',
            { ...context, selectedClipIds: ['clip-intro', 'clip-chorus'] }
        );
        const lockedClip = {
            ...context.tracks[0]!.clips[0]!,
            id: 'clip-locked',
            name: 'Locked',
            locked: true,
        };
        const locked = bridge(
            [{ name: 'renameClip', arguments: { clipId: lockedClip.id, name: 'Open' } }],
            'rename Locked clip to Open',
            {
                ...context,
                tracks: [
                    { ...context.tracks[0]!, clips: [...context.tracks[0]!.clips, lockedClip] },
                    ...context.tracks.slice(1),
                ],
            }
        );

        expect(multiSelection.actions).toEqual([]);
        expect(locked.actions).toEqual([]);
    });

    it('requires explicit non-negated clip deletion and rejects cross-entity or generic-delete ties', () => {
        const context = createClipContext();
        const explicit = bridge(
            [{ name: 'removeClip', arguments: { clipId: 'clip-chorus' } }],
            'delete Chorus clip',
            context
        );
        const negated = bridge(
            [{ name: 'removeClip', arguments: { clipId: 'clip-chorus' } }],
            'do not delete Chorus clip',
            context
        );
        const deviceRemoval = bridge(
            [{ name: 'removeClip', arguments: { clipId: 'clip-eq' } }],
            'remove EQ from Vocals',
            context
        );
        const trackRemoval = bridge(
            [{ name: 'removeClip', arguments: { clipId: 'clip-vocals-verse' } }],
            'remove Vocals track',
            context
        );
        const genericTie = bridge(
            [{ name: 'removeClip', arguments: { clipId: 'clip-bridge' } }],
            'delete Bridge',
            context
        );
        const explicitTie = bridge(
            [{ name: 'removeClip', arguments: { clipId: 'clip-bridge' } }],
            'delete Bridge clip',
            context
        );
        const genericTrackTie = bridge(
            [{ name: 'removeTrack', arguments: { trackId: 'track-bridge' } }],
            'delete Bridge',
            context
        );
        const explicitTrackTie = bridge(
            [{ name: 'removeTrack', arguments: { trackId: 'track-bridge' } }],
            'delete Bridge track',
            context
        );
        const reservedNameClip = {
            ...context.tracks[0]!.clips[0]!,
            id: 'clip-track-name',
            name: 'Track',
        };
        const reservedEntityWord = bridge(
            [{ name: 'removeClip', arguments: { clipId: reservedNameClip.id } }],
            'remove track',
            {
                ...context,
                tracks: [
                    { ...context.tracks[0]!, clips: [...context.tracks[0]!.clips, reservedNameClip] },
                    ...context.tracks.slice(1),
                ],
            }
        );
        const crossEntityClip = {
            ...context.tracks[0]!.clips[0]!,
            id: 'clip-vocals-name',
            name: 'Vocals',
        };
        const explicitTrackRequest = bridge(
            [{ name: 'removeClip', arguments: { clipId: crossEntityClip.id } }],
            'delete the Vocals track',
            {
                ...context,
                tracks: [
                    { ...context.tracks[0]!, clips: [...context.tracks[0]!.clips, crossEntityClip] },
                    ...context.tracks.slice(1),
                ],
            }
        );

        expect(explicit.actions).toEqual([{ type: 'removeClip', payload: { clipId: 'clip-chorus' } }]);
        expect(negated.actions).toEqual([]);
        expect(deviceRemoval.actions).toEqual([]);
        expect(trackRemoval.actions).toEqual([]);
        expect(genericTie.actions).toEqual([]);
        expect(explicitTie.actions).toEqual([{ type: 'removeClip', payload: { clipId: 'clip-bridge' } }]);
        expect(genericTrackTie.actions).toEqual([]);
        expect(explicitTrackTie.actions).toEqual([{ type: 'removeTrack', payload: { trackId: 'track-bridge' } }]);
        expect(reservedEntityWord.actions).toEqual([]);
        expect(explicitTrackRequest.actions).toEqual([]);
    });

    it('grounds sidechain endpoints by source and destination roles', () => {
        const kick = createTrack({ id: 'track-kick', name: 'Kick' });
        const bass = createTrack({
            id: 'track-bass',
            name: 'Bass',
            devices: [
                {
                    id: 'device-sidechain',
                    type: 'builtin-sidechain-compressor',
                    bypassed: false,
                    parameters: [],
                },
            ],
        });
        const context: ProjectContext = {
            ...projectContext,
            tracks: [kick, bass, master],
            sidechainRoutes: [],
        };
        const grounded = bridge(
            [{ name: 'addSidechainRoute', arguments: { sourceTrackId: kick.id, targetTrackId: bass.id } }],
            'add sidechain from Kick to Bass',
            context
        );
        const reversed = bridge(
            [{ name: 'addSidechainRoute', arguments: { sourceTrackId: bass.id, targetTrackId: kick.id } }],
            'add sidechain from Kick to Bass',
            context
        );

        expect(grounded.actions).toEqual([
            { type: 'addSidechainRoute', payload: { sourceTrackId: kick.id, targetTrackId: bass.id } },
        ]);
        expect(reversed.actions).toEqual([]);
        expect(reversed.rejections[0]?.reason).toContain('targetTrackId');
    });

    it('grounds gain and pan lane creation only when the requested parameter is explicit', () => {
        const contextWithoutAutomation = { ...projectContext, automationLanes: [] };
        const gain = bridge(
            [{ name: 'addAutomationLane', arguments: { trackId: 'track-vocals', parameterId: 'gain' } }],
            'automate track volume on Vocals',
            contextWithoutAutomation
        );
        const pan = bridge(
            [{ name: 'addAutomationLane', arguments: { trackId: 'track-guitar', parameterId: 'pan' } }],
            'automate track panning on Guitar',
            contextWithoutAutomation
        );
        const vague = bridge(
            [{ name: 'addAutomationLane', arguments: { trackId: 'track-guitar', parameterId: 'gain' } }],
            'add automation lane on Guitar'
        );

        expect(gain.actions).toEqual([
            {
                type: 'addAutomationLane',
                payload: { trackId: 'track-vocals', parameterId: 'gain', parameterName: 'Gain' },
            },
        ]);
        expect(pan.actions).toEqual([
            {
                type: 'addAutomationLane',
                payload: { trackId: 'track-guitar', parameterId: 'pan', parameterName: 'Pan' },
            },
        ]);
        expect(vague.actions).toEqual([]);
        expect(vague.rejections[0]?.reason).toContain('parameterId');
    });

    it('grounds automation lane edits by parameter name and owner track', () => {
        const point = bridge(
            [
                {
                    name: 'addAutomationPoint',
                    arguments: { laneId: 'lane-vocal-gain', beat: 8, value: 0.5 },
                },
            ],
            'add automation point to Gain on Vocals at beat 8 with value 0.5'
        );
        const disable = bridge(
            [
                {
                    name: 'setAutomationLaneEnabled',
                    arguments: { laneId: 'lane-vocal-gain', enabled: false },
                },
            ],
            'disable automation for Gain on Vocals'
        );
        const naturalValueAndCurve = bridge(
            [
                {
                    name: 'addAutomationPoint',
                    arguments: { laneId: 'lane-vocal-gain', beat: 8, value: 0.5, curve: 'smooth' },
                },
            ],
            'add automation point to Gain on Vocals at beat 8 to 50% smooth'
        );
        const omittedRequestedCurve = bridge(
            [
                {
                    name: 'addAutomationPoint',
                    arguments: { laneId: 'lane-vocal-gain', beat: 8, value: 0.5 },
                },
            ],
            'add automation point to Gain on Vocals at beat 8 to 50% smooth'
        );

        expect(point.actions).toEqual([
            { type: 'addAutomationPoint', payload: { laneId: 'lane-vocal-gain', beat: 8, value: 0.5 } },
        ]);
        expect(disable.actions).toEqual([
            { type: 'setAutomationLaneEnabled', payload: { laneId: 'lane-vocal-gain', enabled: false } },
        ]);
        expect(naturalValueAndCurve.actions).toEqual([
            {
                type: 'addAutomationPoint',
                payload: { laneId: 'lane-vocal-gain', beat: 8, value: 0.5, curve: 'smooth' },
            },
        ]);
        expect(omittedRequestedCurve.actions).toEqual([]);
        expect(omittedRequestedCurve.rejections[0]?.reason).toContain('curve');
    });

    it('grounds whole-lane transforms to the named lane owner and explicit factor', () => {
        const populatedContext: ProjectContext = {
            ...projectContext,
            automationLanes: [
                {
                    ...projectContext.automationLanes![0]!,
                    points: [
                        { beat: 0, value: 0.25, curve: 'linear' },
                        { beat: 4, value: 0.75, curve: 'linear' },
                    ],
                },
                {
                    ...projectContext.automationLanes![0]!,
                    id: 'lane-guitar-gain',
                    trackId: 'track-guitar',
                    points: [
                        { beat: 0, value: 0.4, curve: 'linear' },
                        { beat: 4, value: 0.6, curve: 'linear' },
                    ],
                },
            ],
        };
        const grounded = bridge(
            [{ name: 'scaleAutomation', arguments: { laneId: 'lane-vocal-gain', factor: 1.5 } }],
            'scale automation for Gain on Vocals by 1.5',
            populatedContext
        );
        const wrongOwner = bridge(
            [{ name: 'scaleAutomation', arguments: { laneId: 'lane-guitar-gain', factor: 1.5 } }],
            'scale automation for Gain on Vocals by 1.5',
            populatedContext
        );

        expect(grounded.actions).toEqual([
            { type: 'scaleAutomation', payload: { laneId: 'lane-vocal-gain', factor: 1.5 } },
        ]);
        expect(wrongOwner.actions).toEqual([]);
        expect(wrongOwner.rejections[0]?.reason).toContain('laneId');
    });

    it('defaults omitted thinning tolerance but rejects provider-invented or omitted requested values', () => {
        const context: ProjectContext = {
            ...projectContext,
            automationLanes: [
                {
                    ...projectContext.automationLanes![0]!,
                    points: [
                        { beat: 0, value: 0.2, curve: 'linear' },
                        { beat: 2, value: 0.5, curve: 'linear' },
                        { beat: 4, value: 0.8, curve: 'linear' },
                    ],
                },
            ],
        };
        const omitted = bridge(
            [{ name: 'thinAutomation', arguments: { laneId: 'lane-vocal-gain' } }],
            'thin automation for Gain on Vocals',
            context
        );
        const explicit = bridge(
            [{ name: 'thinAutomation', arguments: { laneId: 'lane-vocal-gain', tolerance: 0.05 } }],
            'thin automation for Gain on Vocals with tolerance 0.05',
            context
        );
        const invented = bridge(
            [{ name: 'thinAutomation', arguments: { laneId: 'lane-vocal-gain', tolerance: 0.05 } }],
            'thin automation for Gain on Vocals',
            context
        );
        const dropped = bridge(
            [{ name: 'thinAutomation', arguments: { laneId: 'lane-vocal-gain' } }],
            'thin automation for Gain on Vocals with tolerance 0.05',
            context
        );

        expect(omitted.actions).toEqual([{ type: 'thinAutomation', payload: { laneId: 'lane-vocal-gain' } }]);
        expect(explicit.actions).toEqual([
            { type: 'thinAutomation', payload: { laneId: 'lane-vocal-gain', tolerance: 0.05 } },
        ]);
        expect(invented.actions).toEqual([]);
        expect(invented.rejections[0]?.reason).toContain('tolerance');
        expect(dropped.actions).toEqual([]);
        expect(dropped.rejections[0]?.reason).toContain('tolerance');
    });

    it('grounds automation mode changes to the named track and explicit mode', () => {
        const context: ProjectContext = {
            ...projectContext,
            tracks: projectContext.tracks.map((track) => ({ ...track, automationMode: 'read' })),
        };
        const grounded = bridge(
            [{ name: 'setAutomationMode', arguments: { trackId: 'track-vocals', mode: 'touch' } }],
            'set Vocals automation mode to touch',
            context
        );
        const wrongTrack = bridge(
            [{ name: 'setAutomationMode', arguments: { trackId: 'track-guitar', mode: 'touch' } }],
            'set Vocals automation mode to touch',
            context
        );
        const vague = bridge(
            [{ name: 'setAutomationMode', arguments: { trackId: 'track-vocals', mode: 'write' } }],
            'set automation mode on Vocals',
            context
        );
        const ambiguous = bridge(
            [{ name: 'setAutomationMode', arguments: { trackId: 'track-vocals', mode: 'write' } }],
            'set Vocals automation mode to read or write',
            context
        );
        const off = bridge(
            [{ name: 'setAutomationMode', arguments: { trackId: 'track-vocals', mode: 'off' } }],
            'turn automation mode off on Vocals',
            context
        );

        expect(grounded.actions).toEqual([
            { type: 'setAutomationMode', payload: { trackId: 'track-vocals', mode: 'touch' } },
        ]);
        expect(wrongTrack.actions).toEqual([]);
        expect(wrongTrack.rejections[0]?.reason).toContain('trackId');
        expect(vague.actions).toEqual([]);
        expect(vague.rejections[0]?.reason).toContain('mode');
        expect(ambiguous.actions).toEqual([]);
        expect(ambiguous.rejections[0]?.reason).toContain('mode');
        expect(off.actions).toEqual([{ type: 'setAutomationMode', payload: { trackId: 'track-vocals', mode: 'off' } }]);
    });

    it('grounds percentages against arbitrary existing lane bounds', () => {
        const cutoffContext: ProjectContext = {
            ...projectContext,
            automationLanes: [
                ...projectContext.automationLanes!,
                {
                    id: 'lane-vocal-cutoff',
                    trackId: 'track-vocals',
                    parameterId: 'cutoff',
                    name: 'Cutoff',
                    enabled: true,
                    minValue: 20,
                    maxValue: 20_000,
                    points: [],
                },
            ],
        };
        const prompt = 'add automation point to Cutoff on Vocals at beat 12 to 50%';
        const grounded = bridge(
            [{ name: 'addAutomationPoint', arguments: { laneId: 'lane-vocal-cutoff', beat: 12, value: 10_010 } }],
            prompt,
            cutoffContext
        );
        const wronglyNormalized = bridge(
            [{ name: 'addAutomationPoint', arguments: { laneId: 'lane-vocal-cutoff', beat: 12, value: 0.5 } }],
            prompt,
            cutoffContext
        );

        expect(grounded.actions).toEqual([
            { type: 'addAutomationPoint', payload: { laneId: 'lane-vocal-cutoff', beat: 12, value: 10_010 } },
        ]);
        expect(wronglyNormalized.actions).toEqual([]);
        expect(wronglyNormalized.rejections[0]?.reason).toContain('value');
    });

    it('rejects an automation lane name that is ambiguous without an owner track', () => {
        const result = bridge(
            [
                {
                    name: 'setAutomationLaneEnabled',
                    arguments: { laneId: 'lane-vocal-gain', enabled: false },
                },
            ],
            'disable automation for Gain',
            {
                ...projectContext,
                automationLanes: [
                    ...projectContext.automationLanes!,
                    {
                        ...projectContext.automationLanes![0]!,
                        id: 'lane-guitar-gain',
                        trackId: 'track-guitar',
                    },
                ],
            }
        );

        expect(result.actions).toEqual([]);
        expect(result.rejections[0]?.reason).toContain('ambiguous');
    });
});
