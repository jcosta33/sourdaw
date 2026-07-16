import {
    type ProjectAutomation,
    type ProjectClip,
    type ProjectData,
    type ProjectDevice,
    type ProjectFreezeState,
    type ProjectMarker,
    type ProjectMidi,
    type ProjectMidiNote,
    type ProjectTrack,
    type ProjectTrackAlternative,
} from '../../models/ProjectData';

import { type DawProjectParseResult, type DawProjectParsedClip, type DawProjectParsedTrack } from './dawProjectTypes';

export type MapToProjectDataInput = {
    parsed: DawProjectParseResult;
    bufferIdsByPath: Map<string, string>;
    fileName: string;
};

const PROJECT_SCHEMA_VERSION = 1;

const defaultFreezeState: ProjectFreezeState = { status: 'unfrozen' };

const PASS_THROUGH_DEVICE_TYPES = new Set<string>([
    'builtin-gain',
    'builtin-synth',
    'builtin-eq',
    'builtin-compressor',
    'builtin-reverb',
    'builtin-delay',
]);

function normalizeDeviceType(raw: string): ProjectDevice {
    const lowered = raw.toLowerCase();
    if (PASS_THROUGH_DEVICE_TYPES.has(lowered)) {
        return {
            id: `dev-${crypto.randomUUID()}`,
            name: lowered,
            type: lowered,
            bypassed: false,
            parameterValues: {},
        };
    }
    return {
        id: `dev-${crypto.randomUUID()}`,
        name: raw || 'External Device',
        type: 'builtin-gain',
        bypassed: false,
        parameterValues: {},
    };
}

function mapNote(note: { pitch: number; startBeat: number; duration: number; velocity: number }): ProjectMidiNote {
    return {
        id: `note-${crypto.randomUUID()}`,
        pitch: note.pitch,
        startBeat: note.startBeat,
        duration: note.duration,
        velocity: note.velocity,
        probability: 100,
        pressure: 0,
        slide: 0,
        pitchBend: 0,
    };
}

function mapClip(
    parsedClip: DawProjectParsedClip,
    trackId: string,
    bufferIdsByPath: Map<string, string>
): { clip: ProjectClip; notes: ProjectMidiNote[] } {
    if (parsedClip.type === 'audio') {
        const bufferId = parsedClip.audioAssetPath ? bufferIdsByPath.get(parsedClip.audioAssetPath) : undefined;
        const clip: ProjectClip = {
            id: parsedClip.id,
            trackId,
            name: parsedClip.name,
            startBeat: parsedClip.startBeat,
            endBeat: parsedClip.endBeat,
            type: 'audio',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
            bufferId,
            sampleStartBeat: 0,
        };
        return { clip, notes: [] };
    }

    const notes = (parsedClip.notes ?? []).map(mapNote);
    const clip: ProjectClip = {
        id: parsedClip.id,
        trackId,
        name: parsedClip.name,
        startBeat: parsedClip.startBeat,
        endBeat: parsedClip.endBeat,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        notes,
    };
    return { clip, notes };
}

function mapTrack(
    parsed: DawProjectParsedTrack,
    bufferIdsByPath: Map<string, string>
): { track: ProjectTrack; notesByClipId: Record<string, ProjectMidiNote[]> } {
    const notesByClipId: Record<string, ProjectMidiNote[]> = {};
    const clips: ProjectClip[] = [];
    for (const rawClip of parsed.clips) {
        const { clip, notes } = mapClip(rawClip, parsed.id, bufferIdsByPath);
        clips.push(clip);
        if (notes.length > 0) {
            notesByClipId[clip.id] = notes;
        }
    }

    const devices: ProjectDevice[] =
        parsed.kind === 'midi' && parsed.deviceTypes.length === 0
            ? [
                  {
                      id: `dev-${crypto.randomUUID()}`,
                      name: 'Synth',
                      type: 'builtin-synth',
                      bypassed: false,
                      parameterValues: {},
                  },
              ]
            : parsed.deviceTypes.map(normalizeDeviceType);

    const altId = `${parsed.id}-alt-default`;
    const alternatives: ProjectTrackAlternative[] = [{ id: altId, name: 'Alternative 1', clips: [] }];

    const track: ProjectTrack = {
        id: parsed.id,
        name: parsed.name,
        kind: parsed.kind,
        muted: parsed.mute,
        soloed: parsed.solo,
        armed: false,
        gain: Math.max(0, Math.min(1, parsed.volume)),
        pan: Math.max(-1, Math.min(1, parsed.pan)),
        color: parsed.color,
        clips,
        devices,
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: defaultFreezeState,
        parentId: parsed.parentId,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: parsed.kind === 'master' ? 'hw_out' : 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: parsed.kind === 'bus',
        notes: '',
        inputId: null,
        activeAlternativeId: altId,
        alternatives,
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };

    return { track, notesByClipId };
}

export function mapToProjectData(input: MapToProjectDataInput): ProjectData {
    const { parsed, bufferIdsByPath, fileName } = input;
    const now = Date.now();

    const tracks: ProjectTrack[] = [];
    const notesByClipId: Record<string, ProjectMidiNote[]> = {};
    for (const parsedTrack of parsed.tracks) {
        const mapped = mapTrack(parsedTrack, bufferIdsByPath);
        tracks.push(mapped.track);
        Object.assign(notesByClipId, mapped.notesByClipId);
    }

    const hasMasterTrack = tracks.some((track) => track.kind === 'master');
    if (!hasMasterTrack) {
        const altId = 'master-alt-default';
        tracks.unshift({
            id: 'master',
            name: 'Master',
            kind: 'master',
            muted: false,
            soloed: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            color: '#64748b',
            clips: [],
            devices: [],
            sends: [],
            midiFx: [],
            frozen: false,
            freezeState: defaultFreezeState,
            parentId: null,
            collapsed: false,
            inputMonitoring: 'auto',
            hidden: false,
            disabled: false,
            height: 80,
            outputId: 'hw_out',
            automationMode: 'read',
            groupId: null,
            soloSafe: false,
            notes: '',
            inputId: null,
            activeAlternativeId: altId,
            alternatives: [{ id: altId, name: 'Alternative 1', clips: [] }],
            vcaGroupId: null,
            midiOutputTrackId: null,
            followChordTrack: false,
        });
    }

    const automation: ProjectAutomation = { lanes: [] };
    const midi: ProjectMidi = { notesByClipId, ccByClipId: {}, pitchBendByClipId: {} };
    const markers: ProjectMarker[] = parsed.markers.map((marker, index) => ({
        id: `marker-${String(index)}-${crypto.randomUUID()}`,
        beat: marker.beat,
        name: marker.name,
        color: '#f59e0b',
    }));

    const tempoMap = parsed.tempoChanges.length > 0 ? { changes: parsed.tempoChanges } : undefined;
    const timeSignatureMap =
        parsed.timeSignatureChanges.length > 0 ? { changes: parsed.timeSignatureChanges } : undefined;

    const name = parsed.meta.title.trim() || fileName.replace(/\.dawproject$/i, '') || 'Imported Project';

    return {
        version: PROJECT_SCHEMA_VERSION,
        meta: {
            name,
            createdAt: now,
            updatedAt: now,
            keyRoot: 0,
            scaleName: 'chromatic',
            tuning: {
                name: 'Equal Temperament',
                frequencies: Array.from({ length: 128 }, (_, index) => 440 * 2 ** ((index - 69) / 12)),
            },
        },
        transport: {
            tempo: parsed.initialTempo,
            timeSignatureNumerator: parsed.initialTimeSignature.numerator,
            timeSignatureDenominator: parsed.initialTimeSignature.denominator,
            loopStart: 0,
            loopEnd: 16,
            isLooping: false,
            metronomeEnabled: false,
            metronomeVolume: 0.5,
            punchInEnabled: false,
            punchInBeat: 0,
            punchOutBeat: 0,
            countInEnabled: false,
            countInBars: 1,
            preRollEnabled: false,
            preRollBars: 1,
            masterGain: 0.8,
        },
        arrangement: { tracks },
        automation,
        midi,
        mixer: { master: { gain: 0.8, pan: 0 }, buses: [] },
        markers,
        tempoMap,
        timeSignatureMap,
        history: { checkpoints: [] },
    };
}
