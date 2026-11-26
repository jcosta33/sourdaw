/**
 * The derived, versioned census of every executable command the registry publishes.
 *
 * `AGENT_COMMAND_LEDGER` holds exactly one entry per `actionType` in
 * `executableAppActionRegistry.ts`'s descriptor list. The owner is the handler-map module that
 * registers the actionType (`registerProductionCommandHandlers` in
 * `commandRegistryCompleteness.spec.ts` names the eight maps), never the module that merely
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
    'Project',
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

/**
 * Fails fast when a ledger entry's packet format disagrees with its closure, so the published
 * ledger never carries a `supported` entry pointing at a tracker packet or an `interim-unsupported`
 * entry pointing at a handler factory name.
 */
export function assertPacketMatchesClosure(entry: AgentCommandLedgerEntry): AgentCommandLedgerEntry {
    const packetIsTrackerReference = isInterimPacketReference(entry.packet);
    const shouldBeTrackerReference = entry.closure === 'interim-unsupported';
    if (packetIsTrackerReference !== shouldBeTrackerReference) {
        throw new Error(
            `AGENT_COMMAND_LEDGER entry '${entry.operationId}' has packet '${entry.packet}', which disagrees with its closure '${entry.closure}'.`
        );
    }
    return entry;
}

/** The registering handler factory name for each owner, reused so every supported entry agrees. */
const SUPPORTED_ENTRY_PACKETS: Record<AgentCommandLedgerOwner, string> = {
    Arrangement: 'getArrangementHandlers',
    AudioRendering: 'getAudioRenderingHandlers',
    Automation: 'getAutomationHandlers',
    CrdtDocument: 'getDrumPreviewBranchHandlers',
    MIDI: 'getMidiNoteTransformHandlers',
    Project: 'getProjectHandlers',
    Transport: 'getTransportHandlers',
    Yeast: 'getYeastHandlers',
};

type SupportedEntryTuple = readonly [
    operationId: string,
    category: AgentCommandLedgerCategory,
    owner: AgentCommandLedgerOwner,
    /** The registering handler factory, when it is not the owner's usual one. */
    factory?: string,
];

/** Every entry on this head is registered, so descriptor version 1 and `supported` always apply. */
function toSupportedEntry([operationId, category, owner, factory]: SupportedEntryTuple): AgentCommandLedgerEntry {
    return {
        operationId,
        category,
        owner,
        descriptorVersion: 1,
        packet: factory ?? SUPPORTED_ENTRY_PACKETS[owner],
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
    ['hideTrack', 'track', 'Arrangement'],
    ['foldTrack', 'track', 'Arrangement'],
    ['setTrackHeight', 'track', 'Arrangement'],
    ['clearSolos', 'track', 'Arrangement'],
    ['selectTake', 'track', 'Arrangement'],
    ['setCompRegion', 'track', 'Arrangement'],
    ['removeCompRegion', 'track', 'Arrangement'],
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
    ['quantizeTransients', 'audio-editing', 'Arrangement'],
    ['stripSilence', 'audio-editing', 'Arrangement'],
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
    ['automateParameterRange', 'automation', 'Automation'],
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
    ['scaleVelocities', 'midi', 'MIDI'],
    ['humanizeNotes', 'midi', 'MIDI'],
    ['addChordEvent', 'midi', 'MIDI'],
    ['clearChordTrack', 'midi', 'MIDI'],
    ['toggleChordTrack', 'midi', 'MIDI'],
    ['extractGroove', 'midi', 'MIDI', 'getMidiGrooveHandlers'],
    ['applyGroove', 'midi', 'MIDI', 'getMidiGrooveHandlers'],

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

    // Project — project-timeline. The brief's decisions stay uncovered: a request copies them unchanged.
    ['setProductionBrief', 'project-timeline', 'Project'],

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

type AgentCommandReadLedgerEntry = {
    operationId: string;
    category: AgentCommandLedgerCategory;
    owner: 'AiRuntime';
    /** Application reads are versioned by their hosting tool loop, not an AppAction descriptor. */
    descriptorVersion: null;
    packet: string;
    closure: AgentCommandLedgerClosure;
};

/** Read discovery never adds an executable command or changes the mutation census above. */
export const AGENT_COMMAND_READ_ONLY_LEDGER: readonly AgentCommandReadLedgerEntry[] = [
    {
        operationId: 'analysis.detectTransients',
        category: 'audio-editing',
        owner: 'AiRuntime',
        descriptorVersion: null,
        packet: 'executeTransientOnsetRead',
        closure: 'supported',
    },
];

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
 * Why an AI runtime action type has no executable command. `interim-unsupported` names an edit the
 * agent should own, which its tracker packet registers or retires from the runtime vocabulary;
 * `outside-agent-scope` names a view, panel, transport-control, session or analysis action that is
 * never a project edit an agent command commits. A type whose handler is undoable is a project edit, so it
 * is never outside agent scope.
 */
export type AgentRuntimeActionAccountingRecord =
    | {
          kind: 'interim-unsupported';
          category: AgentCommandLedgerCategory;
          packet: string;
          reason: string;
          actionTypes: readonly string[];
      }
    | {
          kind: 'outside-agent-scope';
          category: 'view' | 'panel' | 'transport-control' | 'session' | 'analysis';
          reason: string;
          actionTypes: readonly string[];
      };

const RUNTIME_ACTION_PACKET = '#6473';

/**
 * The accounting for every AI runtime action type (`RUNTIME_ACTION_TYPES`) that no executable
 * descriptor publishes. A runtime action type is covered exactly once: by a descriptor or by one
 * record here, never both and never neither, and a record names only live runtime action types.
 */
export const AGENT_RUNTIME_ACTION_ACCOUNTING: readonly AgentRuntimeActionAccountingRecord[] = [
    {
        kind: 'interim-unsupported',
        category: 'track',
        packet: RUNTIME_ACTION_PACKET,
        reason: 'Track-level edits whose handlers carry no executable descriptor, target capability, effect declaration or session replay contract yet.',
        actionTypes: [
            'disableTrack',
            'createFolder',
            'groupTracks',
            'ungroupTracks',
            'setTrackNotes',
            'createTrackAlternative',
            'switchTrackAlternative',
            'renameTrackAlternative',
            'deleteTrackAlternative',
            'loadTrackTemplate',
        ],
    },
    {
        kind: 'interim-unsupported',
        category: 'track',
        packet: RUNTIME_ACTION_PACKET,
        reason: "A vertical zoom's sign must follow the user's words, and no grounding rule yet tells a shrink from a grow reliably in ordinary prompts, so the command is registered once a direction rule is proven.",
        actionTypes: ['zoomTracksVertical'],
    },
    {
        kind: 'interim-unsupported',
        category: 'project-timeline',
        packet: RUNTIME_ACTION_PACKET,
        reason: 'Undoable transport settings with no executable descriptor yet. setCountInBars and setPreRollBars describe their inverse, but toggleCountIn and togglePreRoll do not, and none of the four has an executable descriptor yet, so the packet registers the bar setters and gives the toggles an inverse or retires them.',
        actionTypes: ['toggleCountIn', 'setCountInBars', 'togglePreRoll', 'setPreRollBars'],
    },
    {
        kind: 'interim-unsupported',
        category: 'render-freeze-export',
        packet: RUNTIME_ACTION_PACKET,
        reason: 'Render and freeze edits replace live tracks or clips with rendered audio through asynchronous jobs; none publishes a preview capability or an inverse a saved history can replay.',
        actionTypes: [
            'freezeTrack',
            'unfreezeTrack',
            'flattenTrack',
            'bounceInPlace',
            'consolidateSelection',
            'bounceSelection',
            'consolidateAllTracks',
            'bounceToNewTrack',
        ],
    },
    {
        kind: 'interim-unsupported',
        category: 'clip',
        packet: RUNTIME_ACTION_PACKET,
        reason: 'Clip edits that create comp and pattern structures, which no target capability grounds yet.',
        actionTypes: ['createCompGroup', 'createPatternInstance', 'detachPatternInstance'],
    },
    {
        kind: 'interim-unsupported',
        category: 'audio-editing',
        packet: RUNTIME_ACTION_PACKET,
        reason: 'Audio clip edits with no executable descriptor or typed provider payload yet; their handlers accept unchecked runtime payloads.',
        actionTypes: ['reverseClip'],
    },
    {
        kind: 'interim-unsupported',
        category: 'midi',
        packet: RUNTIME_ACTION_PACKET,
        reason: 'Generative note actions that predate the MIDI transform route; the packet registers each as a transform that compiles to addNotes or retires it from the runtime vocabulary.',
        actionTypes: ['generateDrumPattern', 'generateMelody', 'generateChordProgression'],
    },
    {
        kind: 'interim-unsupported',
        category: 'project-timeline',
        packet: RUNTIME_ACTION_PACKET,
        reason: 'Timeline edits that move or rewrite content across every track; none is registered with a preview capability or a project-wide effect declaration yet.',
        actionTypes: [
            'addTimeSignatureChange',
            'removeTimeSignatureChange',
            'deleteTime',
            'insertTime',
            'duplicateTimeRange',
        ],
    },
    {
        kind: 'interim-unsupported',
        category: 'automation',
        packet: RUNTIME_ACTION_PACKET,
        reason: 'Automation edits with no executable descriptor yet.',
        actionTypes: ['createAdjustmentLayer'],
    },
    {
        kind: 'interim-unsupported',
        category: 'routing',
        packet: RUNTIME_ACTION_PACKET,
        reason: 'MIDI output edits target hardware ports, which no target capability grounds yet.',
        actionTypes: ['setMidiOutput', 'clearMidiOutput'],
    },
    {
        kind: 'outside-agent-scope',
        category: 'view',
        reason: 'View state (selection, tools, horizontal zoom, snap, workspace mode) changes what the musician sees and records no undo entry, so it is not the project an agent edits.',
        actionTypes: [
            'selectTrack',
            'setWorkspaceMode',
            'setEditingTool',
            'setMarqueeSelection',
            'setSnapValue',
            'zoomToFit',
            'zoomToSelection',
        ],
    },
    {
        kind: 'outside-agent-scope',
        category: 'panel',
        reason: 'Panels and dialogs open and close application chrome, not project content.',
        actionTypes: [
            'openPreferencesDialog',
            'openMixer',
            'closeMixer',
            'toggleSidebar',
            'toggleInspector',
            'toggleChatPanel',
            'toggleNodeView',
            'toggleUndoTree',
            'toggleScratchPad',
        ],
    },
    {
        kind: 'outside-agent-scope',
        category: 'transport-control',
        reason: 'Transport, recording and performance toggles drive playback the musician controls live and record no undo entry; the agent sets loop, metronome and punch state through the registered set commands.',
        actionTypes: [
            'togglePlayback',
            'toggleRecording',
            'toggleLoopRecord',
            'togglePunchRecording',
            'triggerScene',
            'nextSetlistItem',
            'previousSetlistItem',
        ],
    },
    {
        kind: 'outside-agent-scope',
        category: 'session',
        reason: 'Session actions act on files, collaboration, hardware, MPE controller input mode (switching it while a take records writes the switch into that take as recorded input), monitoring, user libraries, macros and the undo stacks rather than on project content; agent reverts run through revert groups.',
        actionTypes: [
            'enableMpe',
            'disableMpe',
            'saveProject',
            'newProject',
            'exportProject',
            'exportMidi',
            'exportDawProject',
            'savePreset',
            'saveTrackTemplate',
            'deleteTrackTemplate',
            'createCollabSession',
            'joinCollabSession',
            'leaveCollabSession',
            'scanPlugins',
            'connectPush',
            'disconnectPush',
            'setControlSurface',
            'switchMonitor',
            'toggleControlRoomDim',
            'toggleControlRoomMono',
            'undo',
            'redo',
            'labelUndoBranch',
            'startMacroRecording',
            'stopMacroRecording',
            'playMacro',
            'deleteMacro',
        ],
    },
    {
        kind: 'outside-agent-scope',
        category: 'analysis',
        reason: 'Analysis actions read the project and report a result or display state, writing no project content; the planner reaches analysis through its read tools.',
        actionTypes: ['analyzeMix', 'detectTempo', 'detectKey', 'getLatencyReport'],
    },
];

/**
 * The minimum-write-set rule: an executable command is safe for an agent to commit without
 * explicit confirmation only when its registry risk is `bounded-reversible` and it is visible
 * (discoverability absent or `'visible'`) to planners.
 */
export const AGENT_COMMAND_MINIMUM_WRITE_SET_RULE = {
    risk: 'bounded-reversible',
    discoverability: 'visible',
} as const;
