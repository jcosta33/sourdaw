import { type AppAction } from '#/utils/handlerContract';

import { AGENT_PREVIEW_DOMAINS, type AgentPreviewDomain } from '../../models/AgentDomainPreview';

/**
 * Which preview domains a proposed batch touches.
 *
 * The membership contract, by operation:
 *
 * - `device-graph`: operations that add, remove, or re-point a node or edge of
 *   the compiled audio graph — track and bus lifecycle, device chain order, and
 *   every routed operation (`createBus`, `addSend`, `setSend`, `removeSend`,
 *   `setTrackOutput`, `addSidechainRoute`, `removeSidechainRoute`). Parameter
 *   edits such as `setTrackGain` or `setDeviceParameter` change no topology and
 *   are deliberately absent.
 * - `automation-curve`: every operation whose lowercase name contains
 *   `automation`, the same law the semantic diff uses to mark a fact automated.
 * - `midi-overlay`: operations that write note content into a clip, including
 *   the generative ones whose notes arrive from outside the project.
 * - `audio-audition`: operations that change what a clip sounds like, plus
 *   `addClip` whose payload declares an audio clip.
 *
 * Operations matching none — renames, colours, tempo, transport, selection —
 * map to no domain. The union is returned in `AGENT_PREVIEW_DOMAINS` order.
 */

const DEVICE_GRAPH_OPERATIONS = new Set<AppAction['type']>([
    'addTrack',
    'removeTrack',
    'duplicateTrack',
    'createBus',
    'createFolder',
    'addDevice',
    'removeDevice',
    'reorderDevices',
    'addSend',
    'setSend',
    'removeSend',
    'setTrackOutput',
    'addSidechainRoute',
    'removeSidechainRoute',
]);

const MIDI_OVERLAY_OPERATIONS = new Set<AppAction['type']>([
    'addNotes',
    'applyGroove',
    'arpeggiate',
    'audioToMidi',
    'completeMidi',
    'copyMidiArticulations',
    'generateBassline',
    'generateChordProgression',
    'generateDrumPattern',
    'generateFill',
    'generateMelody',
    'humanizeNotes',
    'importMidiFile',
    'invertNotes',
    'quantizeNoteLengths',
    'quantizeNotes',
    'removeShortMidiOverlaps',
    'retrogradeNotes',
    'scaleAllVelocities',
    'scaleVelocities',
    'setAllVelocities',
    'transposeNotes',
    'variationMidi',
]);

const AUDIO_AUDITION_OPERATIONS = new Set<AppAction['type']>([
    'bounceInPlace',
    'bounceSelection',
    'bounceToNewTrack',
    'commitPitchEdit',
    'consolidateAllTracks',
    'consolidateSelection',
    'crossfadeClips',
    'enableWarping',
    'freezeTrack',
    'glueClips',
    'importAudioFile',
    'importStemSet',
    'normalizeClip',
    'reverseClip',
    'setClipFade',
    'setClipGain',
    'setClipStretchMode',
    'setClipStretchRatio',
    'slipClipContent',
    'stemSeparate',
    'stripSilence',
    'trimClipEnd',
    'trimClipStart',
]);

function placesAudioClip(action: AppAction): boolean {
    return action.type === 'addClip' && action.payload.type === 'audio';
}

function touchesDomain(action: AppAction, domain: AgentPreviewDomain): boolean {
    if (domain === 'midi-overlay') {
        return MIDI_OVERLAY_OPERATIONS.has(action.type);
    }
    if (domain === 'audio-audition') {
        return AUDIO_AUDITION_OPERATIONS.has(action.type) || placesAudioClip(action);
    }
    if (domain === 'automation-curve') {
        return action.type.toLowerCase().includes('automation');
    }
    return DEVICE_GRAPH_OPERATIONS.has(action.type);
}

export function resolveAgentPreviewDomains(actions: readonly AppAction[]): readonly AgentPreviewDomain[] {
    return AGENT_PREVIEW_DOMAINS.filter((domain) => actions.some((action) => touchesDomain(action, domain)));
}
