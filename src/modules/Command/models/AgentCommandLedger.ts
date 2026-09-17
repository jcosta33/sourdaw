/**
 * The derived, versioned census of every executable command the registry publishes.
 *
 * `AGENT_COMMAND_LEDGER` holds exactly one entry per `actionType` in
 * `executableAppActionRegistry.ts`'s descriptor list. The owner is the handler-map module that
 * registers the actionType (`registerProductionCommandHandlers` in
 * `commandRegistryCompleteness.spec.ts` names the seven maps), never the module that merely
 * describes or targets the operation. An entry not yet backed by a registered handler is
 * `interim-unsupported` and carries a tracker packet (`/^#\d+$/`) naming the later work instead of
 * a handler factory name; every entry on this head is `supported`, since every descriptor already
 * has a registered handler ([commandRegistryCompleteness.spec.ts]'s completeness assertion fails
 * closed otherwise).
 */

export const AGENT_COMMAND_LEDGER_SCHEMA_VERSION = 1 as const;

export const AGENT_COMMAND_LEDGER_CATEGORIES = [
    'project-timeline',
    'track',
    'clip',
    'midi',
    'audio-editing',
    'device',
    'parameter',
    'macro',
    'automation',
    'routing',
    'asset',
    'render-freeze-export',
    'history',
    'branch',
    'revert',
    'decision',
] as const;

export type AgentCommandLedgerCategory = (typeof AGENT_COMMAND_LEDGER_CATEGORIES)[number];

export const AGENT_COMMAND_LEDGER_OWNERS = [
    'Arrangement',
    'AudioRendering',
    'Automation',
    'CrdtDocument',
    'MIDI',
    'Transport',
    'Yeast',
] as const;

export type AgentCommandLedgerOwner = (typeof AGENT_COMMAND_LEDGER_OWNERS)[number];

export type AgentCommandLedgerClosure = 'supported' | 'interim-unsupported';

export type AgentCommandLedgerEntry = {
    operationId: string;
    category: AgentCommandLedgerCategory;
    owner: AgentCommandLedgerOwner;
    descriptorVersion: number;
    /**
     * The implementation packet: the registering handler factory name (e.g.
     * `getArrangementHandlers`) for a `supported` entry, or a tracker reference matching
     * `/^#\d+$/` naming the later packet for an `interim-unsupported` entry.
     */
    packet: string;
    closure: AgentCommandLedgerClosure;
};

/**
 * Whether a packet string is a tracker reference (e.g. `#2372`) rather than a registering handler
 * factory name. An `interim-unsupported` entry's packet must satisfy this; a `supported` entry's
 * packet must not.
 */
export function isInterimPacketReference(packet: string): boolean {
    return /^#\d+$/.test(packet);
}

/** The registering handler factory name for each owner, reused so every supported entry agrees. */
const SUPPORTED_ENTRY_PACKETS: Record<AgentCommandLedgerOwner, string> = {
    Arrangement: 'getArrangementHandlers',
    AudioRendering: 'getAudioRenderingHandlers',
    Automation: 'getAutomationHandlers',
    CrdtDocument: 'getDrumPreviewBranchHandlers',
    MIDI: 'getMidiNoteTransformHandlers',
    Transport: 'getTransportHandlers',
    Yeast: 'getYeastHandlers',
};

type SupportedEntryTuple = readonly [
    operationId: string,
    category: AgentCommandLedgerCategory,
    owner: AgentCommandLedgerOwner,
];

/** Every entry on this head is registered, so descriptor version 1 and `supported` always apply. */
function toSupportedEntry([operationId, category, owner]: SupportedEntryTuple): AgentCommandLedgerEntry {
    return {
        operationId,
        category,
        owner,
        descriptorVersion: 1,
        packet: SUPPORTED_ENTRY_PACKETS[owner],
        closure: 'supported',
    };
}

const AGENT_COMMAND_LEDGER_TUPLES: readonly SupportedEntryTuple[] = [
    // Arrangement — asset
    ['importStemSet', 'asset', 'Arrangement'],
    // Arrangement — track
    ['addTrack', 'track', 'Arrangement'],
    ['removeTrack', 'track', 'Arrangement'],
    ['renameTrack', 'track', 'Arrangement'],
    ['muteTrack', 'track', 'Arrangement'],
    ['soloTrack', 'track', 'Arrangement'],
    ['setSoloSafe', 'track', 'Arrangement'],
    ['armTrack', 'track', 'Arrangement'],
    ['duplicateTrack', 'track', 'Arrangement'],
    ['reorderTrack', 'track', 'Arrangement'],
    ['setTrackGain', 'track', 'Arrangement'],
    ['setTrackPan', 'track', 'Arrangement'],
    ['setTrackColor', 'track', 'Arrangement'],
    ['clearSolos', 'track', 'Arrangement'],
    ['selectTake', 'track', 'Arrangement'],
    ['setCompRegion', 'track', 'Arrangement'],
    ['createVcaGroup', 'track', 'Arrangement'],
    ['assignToVca', 'track', 'Arrangement'],
    ['removeFromVca', 'track', 'Arrangement'],
    ['setVcaGain', 'track', 'Arrangement'],
    // Arrangement — routing
    ['createBus', 'routing', 'Arrangement'],
    ['setTrackOutput', 'routing', 'Arrangement'],
    ['addSend', 'routing', 'Arrangement'],
    ['setSend', 'routing', 'Arrangement'],
    ['removeSend', 'routing', 'Arrangement'],
    ['addSidechainRoute', 'routing', 'Arrangement'],
    ['removeSidechainRoute', 'routing', 'Arrangement'],
    // Arrangement — clip
    ['addClip', 'clip', 'Arrangement'],
    ['duplicateClip', 'clip', 'Arrangement'],
    ['duplicateClipToNextBar', 'clip', 'Arrangement'],
    ['removeClip', 'clip', 'Arrangement'],
    ['moveClip', 'clip', 'Arrangement'],
    ['splitClip', 'clip', 'Arrangement'],
    ['renameClip', 'clip', 'Arrangement'],
    ['trimClipStart', 'clip', 'Arrangement'],
    ['trimClipEnd', 'clip', 'Arrangement'],
    ['nudgeClip', 'clip', 'Arrangement'],
    ['slipClipContent', 'clip', 'Arrangement'],
    ['drawClip', 'clip', 'Arrangement'],
    ['duplicateClipAt', 'clip', 'Arrangement'],
    ['moveClips', 'clip', 'Arrangement'],
    ['setClipGain', 'clip', 'Arrangement'],
    ['muteClip', 'clip', 'Arrangement'],
    ['setClipColor', 'clip', 'Arrangement'],
    ['lockClip', 'clip', 'Arrangement'],
    ['setClipLoop', 'clip', 'Arrangement'],
    ['setClipLoopLength', 'clip', 'Arrangement'],
    // Arrangement — audio-editing
    ['setClipFade', 'audio-editing', 'Arrangement'],
    ['glueClips', 'audio-editing', 'Arrangement'],
    ['crossfadeClips', 'audio-editing', 'Arrangement'],
    ['normalizeClip', 'audio-editing', 'Arrangement'],
    ['setClipStretchMode', 'audio-editing', 'Arrangement'],
    ['setClipStretchRatio', 'audio-editing', 'Arrangement'],
    ['fitClipToBeats', 'audio-editing', 'Arrangement'],
    // Arrangement — midi (arpeggiate is Arrangement-owned; every other note operation is MIDI-owned)
    ['arpeggiate', 'midi', 'Arrangement'],
    // Arrangement — device / parameter
    ['addDevice', 'device', 'Arrangement'],
    ['removeDevice', 'device', 'Arrangement'],
    ['bypassDevice', 'device', 'Arrangement'],
    ['setDeviceParameter', 'parameter', 'Arrangement'],
    // Arrangement — project-timeline (markers/sections)
    ['addMarker', 'project-timeline', 'Arrangement'],
    ['removeMarker', 'project-timeline', 'Arrangement'],
    ['setMarkerColor', 'project-timeline', 'Arrangement'],
    ['addSection', 'project-timeline', 'Arrangement'],
    ['removeSection', 'project-timeline', 'Arrangement'],
    ['renameSection', 'project-timeline', 'Arrangement'],
    // Arrangement — automation (adjustment regions and per-track automation mode)
    ['addAdjustmentRegion', 'automation', 'Arrangement'],
    ['setAutomationMode', 'automation', 'Arrangement'],

    // AudioRendering — render-freeze-export
    ['renderProjectSections', 'render-freeze-export', 'AudioRendering'],

    // Automation — automation
    ['addAutomationLane', 'automation', 'Automation'],
    ['addAutomationPoint', 'automation', 'Automation'],
    ['setAutomationLaneEnabled', 'automation', 'Automation'],
    ['automateSendRange', 'automation', 'Automation'],
    ['automateSendRanges', 'automation', 'Automation'],
    ['automateTrackGainRange', 'automation', 'Automation'],
    ['scaleAutomation', 'automation', 'Automation'],
    ['stretchAutomation', 'automation', 'Automation'],
    ['invertAutomation', 'automation', 'Automation'],
    ['reverseAutomation', 'automation', 'Automation'],
    ['thinAutomation', 'automation', 'Automation'],
    ['quantizeAutomation', 'automation', 'Automation'],

    // CrdtDocument — branch
    ['createDrumPreviewBranches', 'branch', 'CrdtDocument'],

    // MIDI — midi
    ['addNotes', 'midi', 'MIDI'],
    ['quantizeNotes', 'midi', 'MIDI'],
    ['removeShortMidiOverlaps', 'midi', 'MIDI'],
    ['copyMidiArticulations', 'midi', 'MIDI'],
    ['transposeNotes', 'midi', 'MIDI'],
    ['invertNotes', 'midi', 'MIDI'],
    ['retrogradeNotes', 'midi', 'MIDI'],
    ['quantizeNoteLengths', 'midi', 'MIDI'],
    ['scaleAllVelocities', 'midi', 'MIDI'],
    ['setAllVelocities', 'midi', 'MIDI'],

    // Transport — project-timeline
    ['setTempo', 'project-timeline', 'Transport'],
    ['setTimeSignature', 'project-timeline', 'Transport'],
    ['setPlayback', 'project-timeline', 'Transport'],
    ['stopPlayback', 'project-timeline', 'Transport'],
    ['seekPlayhead', 'project-timeline', 'Transport'],
    ['setLoopEnabled', 'project-timeline', 'Transport'],
    ['setLoopRegion', 'project-timeline', 'Transport'],
    ['setPunchIn', 'project-timeline', 'Transport'],
    ['setPunchOut', 'project-timeline', 'Transport'],
    ['setPunchEnabled', 'project-timeline', 'Transport'],
    ['setMetronomeEnabled', 'project-timeline', 'Transport'],
    ['setMetronomeVolume', 'project-timeline', 'Transport'],
    ['setMasterGain', 'project-timeline', 'Transport'],

    // Yeast — parameter / device
    ['setYeastProcessorParam', 'parameter', 'Yeast'],
    ['setYeastArpPattern', 'parameter', 'Yeast'],
    ['setYeastProcessorBypass', 'device', 'Yeast'],
    ['addYeastProcessor', 'device', 'Yeast'],
    ['removeYeastProcessor', 'device', 'Yeast'],
    ['reorderYeastProcessor', 'device', 'Yeast'],
] as const;

export const AGENT_COMMAND_LEDGER: readonly AgentCommandLedgerEntry[] =
    AGENT_COMMAND_LEDGER_TUPLES.map(toSupportedEntry);

/**
 * The published categories no registered executable command currently targets. Each names the
 * later packet and the factual reason the category has zero ledger entries today.
 */
export const AGENT_COMMAND_LEDGER_UNCOVERED_CATEGORIES: readonly {
    category: AgentCommandLedgerCategory;
    packet: string;
    reason: string;
}[] = [
    {
        category: 'macro',
        packet: '#2372',
        reason: 'Macro playback replays recorded AppActions through getMacroHandlers, not through the executable command registry.',
    },
    {
        category: 'history',
        packet: '#2372',
        reason: 'Undo and redo are app-action handlers (getUndoRedoHandlers, getUndoTreeHandlers) outside the executable registry, not registry-published commands.',
    },
    {
        category: 'revert',
        packet: '#2372',
        reason: 'Agent reverts run through AiRuntime revert groups (revertAiActionGroup), not through a registered executable command.',
    },
    {
        category: 'decision',
        packet: '#2372',
        reason: 'Production-brief decisions mutate through Project use cases, not through a registered executable command.',
    },
] as const;

/**
 * The minimum-write-set rule: an executable command is safe for an agent to commit without
 * explicit confirmation only when its registry risk is `bounded-reversible` and it is visible
 * (discoverability absent or `'visible'`) to planners.
 */
export const AGENT_COMMAND_MINIMUM_WRITE_SET_RULE = {
    risk: 'bounded-reversible',
    discoverability: 'visible',
} as const;
