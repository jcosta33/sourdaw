import { type ProductionBrief, type ProductionBriefLock } from './ProductionBrief';
import {
    type ProjectAutomationLane,
    type ProjectCheckpoint,
    type ProjectClipKneadState,
    type ProjectDeviceStateChunk,
    type ProjectFreezeState,
    type ProjectMarker,
    type ProjectTake,
} from './ProjectData';

export const AGENT_PROJECT_MODEL_SCHEMA = 'sourdaw.agent-project-model' as const;
export const AGENT_PROJECT_MODEL_SCHEMA_VERSION = 1 as const;

export type AgentProjectIdentity = {
    projectId: string;
    legacyProjectId: string;
};

export type AgentProjectDevice = {
    instanceId: string;
    name: string;
    type: string;
    version: number | null;
    slot: number;
    bypassed: boolean;
    preset: string | null;
    parameters: Array<{ id: string; value: number; unit: string | null }>;
    ports: { inputs: string[]; outputs: string[] };
    latencySeconds: number | null;
    tailSeconds: number | null;
    state: ProjectDeviceStateChunk | { version: null; opaqueBase64: string } | null;
    manifest: null;
};

export type AgentProjectMidiNote = {
    id: string;
    pitch: number;
    timing: { startBeat: number; durationBeats: number; releaseBeat: number };
    velocity: number;
    channel: number;
    probability: number;
    articulation: string | null;
    expression: { pressure: number; slide: number; pitchBend: number; pitchBendRangeSemitones: number | null };
    perNoteAutomation: Array<{ parameterId: string; beat: number; value: number }>;
    quantization: null;
    humanization: null;
    provenance: null;
};

export type AgentProjectClip = {
    id: string;
    name: string;
    source: {
        kind: 'audio' | 'midi';
        assetId: string | null;
        storageKind: 'embedded' | 'reference' | 'unresolved' | null;
        bufferId: string | null;
        fileId: string | null;
    };
    timing: { startBeat: number; endBeat: number; durationBeats: number };
    offset: { audioBeats: number; midiBeats: number };
    loop: { enabled: boolean; lengthBeats: number | null };
    gain: number;
    fades: { inBeats: number; outBeats: number };
    stretch: { mode: 'off' | 'repitch' | 'timestretch'; ratio: number };
    pitch: { keyRoot: number | null; scaleName: string | null };
    warp: { markers: []; kneadState: ProjectClipKneadState | null };
    takes: ProjectTake[];
    comp: Array<{ startBeat: number; endBeat: number; takeId: string }>;
    automation: ProjectAutomationLane[];
    locks: string[];
    midi: { notes: AgentProjectMidiNote[] } | null;
};

export type AgentProjectTrack = {
    id: string;
    name: string;
    type: 'audio' | 'midi' | 'bus' | 'master' | 'folder';
    order: number;
    hierarchy: { parentId: string | null; groupId: string | null };
    tags: string[];
    role: string | null;
    controls: {
        gain: number;
        pan: number;
        muted: boolean;
        soloed: boolean;
        armed: boolean;
        monitoring: 'auto' | 'on' | 'off';
    };
    io: { inputId: string | null; outputId: string };
    devices: AgentProjectDevice[];
    sends: string[];
    sidechains: string[];
    clips: AgentProjectClip[];
    automation: ProjectAutomationLane[];
    freeze: ProjectFreezeState;
    locked: boolean;
};

export type AgentProjectRoute = {
    id: string;
    type: 'output' | 'send' | 'sidechain';
    source: { trackId: string; portId: string | null };
    target: { trackId: string; deviceId: string | null; parameterId: string | null };
    gain: number;
    faderMode: 'pre' | 'post';
    channelMap: null;
    sidechain: boolean;
    cyclePolicy: 'reject';
    enabled: boolean;
    groupId: string | null;
};

export type AgentProjectAsset = {
    id: string;
    contentHash: string;
    storageKind: 'embedded' | 'reference';
    name: string;
    durationSeconds: number | null;
    sampleRate: number | null;
    channels: number | null;
    format: string | null;
    sourceMetadata: { fileId: string | null; bufferId: string | null };
};

export type AgentProjectModelContract = {
    schema: typeof AGENT_PROJECT_MODEL_SCHEMA;
    schemaVersion: typeof AGENT_PROJECT_MODEL_SCHEMA_VERSION;
    projectSchemaVersion: number;
    identity: AgentProjectIdentity;
    metadata: {
        name: string;
        createdAt: number;
        updatedAt: number;
        keyRoot: number;
        scaleName: string;
        tuningName: string;
    };
    sampleRate: number | null;
    tempoMap: Array<{ id: string; beat: number; tempo: number; curve: 'instant' | 'linear' }>;
    meterMap: Array<{ id: string; beat: number; numerator: number; denominator: number }>;
    markers: ProjectMarker[];
    sections: Array<{ id: string; startBeat: number; endBeat: number; name: string; color: string }>;
    arrangement: {
        activeArrangementId: string | null;
        startBeat: number;
        endBeat: number;
        loop: { enabled: boolean; startBeat: number; endBeat: number };
    };
    master: {
        trackId: string | null;
        gain: number;
        pan: number;
        muted: boolean;
        soloed: boolean;
        outputId: string | null;
    };
    settings: {
        metronome: { enabled: boolean; volume: number };
        punch: { enabled: boolean; inBeat: number; outBeat: number };
        countIn: { enabled: boolean; bars: number };
        preRoll: { enabled: boolean; bars: number };
    };
    locks: ProductionBriefLock[];
    brief: ProductionBrief | null;
    warnings: string[];
    tracks: AgentProjectTrack[];
    routing: AgentProjectRoute[];
    assets: AgentProjectAsset[];
    history: ProjectCheckpoint[];
};
