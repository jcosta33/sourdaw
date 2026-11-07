import { type Device, type Track } from '#/modules/Arrangement/stores';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { secondsBetweenBeats } from '#/modules/Transport/useCases';

type Source = NonNullable<Parameters<typeof renderTrackSubgraphOffline>[0]['source']>;

/** Disposable render input: never installed in a document or allocated through live track factories. */
export function createPresetPreviewProject(devices: Device[]) {
    const trackId = `preset-preview-${crypto.randomUUID()}`;
    const clipId = crypto.randomUUID();
    const alternativeId = crypto.randomUUID();
    const clip: Track['clips'][number] = {
        id: clipId,
        trackId,
        name: 'Preview phrase',
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#808080',
        locked: false,
        muted: false,
    };
    const track: Track = {
        id: trackId,
        name: 'Preset preview',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#808080',
        clips: [clip],
        devices,
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'off',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'hw_out',
        automationMode: 'off',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: alternativeId,
        alternatives: [{ id: alternativeId, name: 'Preview', clips: [clip] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
    const tempo = 120;
    const tempoMap: NonNullable<Source['project']['tempoMap']> = {
        changes: [{ id: 'preview-tempo', beat: 0, tempo, curve: 'instant' }],
    };
    const source: Source = {
        project: {
            tracks: { tracks: [track], selectedTrackId: null },
            midi: {
                probabilitySeed: 1,
                noteCoordinateFormat: 'clip-relative',
                notesByClipId: {
                    [clipId]: [
                        { id: crypto.randomUUID(), pitch: 48, startBeat: 0, duration: 0.75, velocity: 110 },
                        { id: crypto.randomUUID(), pitch: 55, startBeat: 1, duration: 0.75, velocity: 78 },
                        { id: crypto.randomUUID(), pitch: 60, startBeat: 2, duration: 1, velocity: 96 },
                    ],
                },
                ccByClipId: {},
                pitchBendByClipId: {},
            },
            transport: {
                isPlaying: false,
                isRecording: false,
                isLooping: false,
                overdubEnabled: false,
                metronomeEnabled: false,
                metronomeVolume: 0,
                tempo,
                timeSignatureNumerator: 4,
                timeSignatureDenominator: 4,
                playheadPosition: 0,
                loopStart: 0,
                loopEnd: 4,
                scheduleGrainMs: 10,
                punchInEnabled: false,
                punchInBeat: 0,
                punchOutBeat: 4,
                countInEnabled: false,
                countInBars: 1,
                preRollEnabled: false,
                preRollBars: 1,
                masterGain: 100,
            },
            tempoMap,
            timeSignatureMap: { changes: [{ id: 'preview-meter', beat: 0, numerator: 4, denominator: 4 }] },
            automationLanes: [],
            takeLanes: { lanes: [] },
            gainEnvelopes: {},
            sidechainRoutes: [],
            vcaGroups: [],
            grooveTemplates: { templates: [], assignments: [] },
            chordTrack: { enabled: false, events: [] },
            yeastProcessorsByDevice: {},
        },
        runtime: {
            buffers: { get: () => undefined },
            deviceLatencyMs: new Map(),
            loadedExternalInstanceIds: new Set(),
            externalPluginParameters: null,
            calibrationByDevice: new Map(),
            soloMode: 'sip',
        },
    };
    const tailSeconds = 4;
    return {
        track,
        source,
        startBeat: 0,
        endBeat: 4,
        tailSeconds,
        durationSeconds: secondsBetweenBeats(tempoMap.changes, 0, 4, tempo) + tailSeconds,
    };
}
