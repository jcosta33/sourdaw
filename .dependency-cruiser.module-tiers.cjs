/* SPDX-FileCopyrightText: Copyright Sourdaw Ltd. */
/* SPDX-License-Identifier: Apache-2.0 */

// ----------------------------------------------------------------------------
// Module tier manifest: the single source for where each src/modules/<Module>
// sits, which tiers it may depend on, and which cycles and upward edges are
// accepted. scripts/check-dependency-boundaries.mjs reads it for the
// `moduleTiers` gate, which compares every non-presentation cross-module edge
// against these rules and every module-level cycle against `allowedCycles`.
// The gate has no baseline file: `allowedCycles` and `acceptedTierEdges` are
// its only known rows, matched exactly.
//
// A module's tier follows its role — its ADR 0011 subdomain kind, its own
// AGENTS.md and the aggregate it owns — never today's import graph, so an
// upward edge must be accepted below with its reason instead of being blessed
// by a tier change. Same-tier edges are always allowed; cycles among them are
// caught separately. A new cycle member, a second cycle, an upward edge, or an
// allowance the code no longer produces all fail the gate. A new allowance is
// argued in review as a change to this file; one the code stops producing is
// shrunk or deleted here.
// ----------------------------------------------------------------------------

const tiers = [
    {
        name: 'kernel',
        meaning: 'Domain-free shared kernels and app-wide settings every module builds on; they know no domain.',
        mayDependOn: [],
    },
    {
        name: 'engine',
        meaning:
            'Execution runtimes that run what the domain hands them and read no domain aggregate; ' +
            'separate from kernel because the document kernel must never know audio or inference.',
        mayDependOn: ['kernel'],
    },
    {
        name: 'core domain',
        meaning: 'Product-differentiating aggregates that own project truth and drive the engine.',
        mayDependOn: ['kernel', 'engine'],
    },
    {
        name: 'device',
        meaning: 'Built-in instruments and effects that plug into the device chain through core and engine contracts.',
        mayDependOn: ['kernel', 'engine', 'core domain'],
    },
    {
        name: 'supporting',
        meaning: 'Necessary non-differentiating capabilities that orbit a core aggregate and know no specific device.',
        mayDependOn: ['kernel', 'engine', 'core domain'],
    },
    {
        name: 'presentation projection',
        meaning: 'Cross-aggregate view surfaces that own no domain aggregate and read widely downstream.',
        mayDependOn: ['kernel', 'engine', 'core domain', 'device', 'supporting'],
    },
    {
        name: 'shell',
        meaning: 'The application shell that composes every surface; nothing below may depend on it.',
        mayDependOn: ['kernel', 'engine', 'core domain', 'device', 'supporting', 'presentation projection'],
    },
];

const modules = {
    Command: { tier: 'kernel', reason: 'Command dispatch, undo history and macros are the shared execution kernel.' },
    CrdtDocument: {
        tier: 'kernel',
        reason: 'The CRDT document, its persistence and branches are the shared truth kernel.',
    },
    Preferences: { tier: 'kernel', reason: 'Generic app-wide settings with no domain language, read by every module.' },

    AudioEngine: { tier: 'engine', reason: 'WebAudio graph runtime that executes the graph and devices it is handed.' },
    BrowserAi: { tier: 'engine', reason: 'Local neural inference runtime with no project timeline knowledge.' },
    PluginHost: { tier: 'engine', reason: 'Third-party plugin hosting runtime: discovery, instances and native IPC.' },

    Arrangement: { tier: 'core domain', reason: 'Owns tracks, clips, takes, markers and device chain topology.' },
    Automation: { tier: 'core domain', reason: 'Owns automation lanes, envelopes and modulation mappings.' },
    Knead: {
        tier: 'core domain',
        reason: 'Single owner of the pitch-edit aggregate (ADR 0011 one language, one owner).',
    },
    MIDI: { tier: 'core domain', reason: 'Owns MIDI note data, controller events and note transforms.' },
    Project: { tier: 'core domain', reason: 'Root project aggregate lifecycle and persistence.' },
    Routing: { tier: 'core domain', reason: 'Owns signal routing topology: sends, buses and sidechains.' },
    SessionLauncher: { tier: 'core domain', reason: 'Owns clip launcher scenes and loop-station recording state.' },
    Transport: { tier: 'core domain', reason: 'Owns the playback clock, tempo and meter maps and loop regions.' },

    Bacteria: { tier: 'device', reason: 'Built-in multiband creative multi-effect.' },
    Crumbs: { tier: 'device', reason: 'Built-in sampler and granular instrument.' },
    Crust: { tier: 'device', reason: 'Built-in mastering limiter and saturator.' },
    Fermenter: { tier: 'device', reason: 'Built-in flagship multi-engine synthesizer.' },
    Gluten: { tier: 'device', reason: 'Built-in multi-topology compressor.' },
    GrandBoule: { tier: 'device', reason: 'Built-in acoustic piano instrument.' },
    Grinder: { tier: 'device', reason: 'Built-in amp modeler, NAM host and cabinet convolver.' },
    Levain: { tier: 'device', reason: 'Built-in orchestral multi-sample instrument.' },
    Proof: { tier: 'device', reason: 'Built-in mastering and spectral shaping suite.' },
    ProofChamber: { tier: 'device', reason: 'Built-in algorithmic reverb.' },
    Synth: { tier: 'device', reason: 'Built-in polyphonic synthesizer and drum synth voices.' },
    Toaster: { tier: 'device', reason: 'Built-in drum sampler and step sequencer.' },
    Tuner: { tier: 'device', reason: 'Built-in tuner device: its panel and pitch telemetry keyed by device.' },
    Yeast: { tier: 'device', reason: 'Built-in generative MIDI processor rack.' },

    AgentAdapters: {
        tier: 'supporting',
        reason: 'External-client contract and admission over Project, Command and AiRuntime.',
    },
    AiGeneration: { tier: 'supporting', reason: 'Pattern generation that feeds core aggregates without owning them.' },
    AiRuntime: { tier: 'supporting', reason: 'LLM orchestration that plans actions against core contracts.' },
    AudioAnalysis: { tier: 'supporting', reason: 'Feature, pitch and tempo analysis and stem separation over audio.' },
    AudioRendering: { tier: 'supporting', reason: 'Export encoding and loudness over rendered audio.' },
    Collaboration: { tier: 'supporting', reason: 'Peer sessions and transport orbiting the CRDT document.' },
    ControlRoom: { tier: 'supporting', reason: 'Monitoring environment utilities orbiting the mix.' },
    ControlSurface: { tier: 'supporting', reason: 'Hardware controller mapping onto core contracts.' },
    CvGate: {
        tier: 'supporting',
        reason: 'CV and gate output conversion orbiting MIDI and routing; not a chain device.',
    },
    DawInterchange: { tier: 'supporting', reason: 'Generic .dawproject import and export translation.' },
    ElasticAudio: { tier: 'supporting', reason: 'Transient and warp editing over Arrangement-owned warp markers.' },
    FactorySynthesis: { tier: 'supporting', reason: 'Offline procedural generation of factory sample packs.' },
    ProjectVersioning: { tier: 'supporting', reason: 'User-facing snapshots over the CRDT document and project.' },
    PunchRecording: { tier: 'supporting', reason: 'Punch boundaries and retrospective capture orbiting Transport.' },
    SampleLibrary: { tier: 'supporting', reason: 'Sample indexing, metadata and similarity search.' },
    Setlist: { tier: 'supporting', reason: 'Live performance song sequencing orbiting Transport and Project.' },

    CommandInterface: {
        tier: 'presentation projection',
        reason: 'Command palette and shortcut routing over every module, owning only key bindings.',
    },
    ContentBrowser: {
        tier: 'presentation projection',
        reason: 'Sidebar browser surface named a projection by ADR 0011.',
    },
    Metering: {
        tier: 'presentation projection',
        reason: 'Meter and scope visuals; ADR 0011 keeps their compute in the engine.',
    },
    MixerConsole: { tier: 'presentation projection', reason: 'Mixer surface named a projection by ADR 0011.' },
    TimelineEditor: { tier: 'presentation projection', reason: 'Timeline surface named a projection by ADR 0011.' },

    Onboarding: { tier: 'shell', reason: 'First-run tour that spotlights targets across the whole workspace.' },
    WorkspaceShell: { tier: 'shell', reason: 'The composition root: layout, panels, tools and dialogs.' },
};

// Each entry is one strongly connected component the gate accepts, matched
// member for member, with the reason it stands and the decision that retires it.
const allowedCycles = [
    {
        name: 'core domain',
        members: [
            'Arrangement',
            'AudioEngine',
            'Automation',
            'ElasticAudio',
            'Knead',
            'MIDI',
            'Project',
            'Routing',
            'Transport',
        ],
        reason:
            'The core aggregates and the engine that realises them read each other densely: the engine reads ' +
            'tracks, notes, automation, routing and the tempo map to build the live and offline graph, and the ' +
            'aggregates schedule, record and render through the engine and read one another to plan edits. ' +
            'Separating them is a boundary redraw, not an import fix.',
        retiredBy:
            'ADR 0011 (.agents/decisions/0011-ddd-module-boundary-redraw.md): its decomposition of the core ' +
            'modules into one-aggregate contexts with one-way edges. Shrink this entry as each member leaves.',
    },
    {
        name: 'kernel',
        members: ['Command', 'CrdtDocument'],
        reason:
            'Command executes every action against the document, so it reads CrdtDocument stores to set the ' +
            'semantic context, replay and revert action history, and refuse mutations during project repair. ' +
            'The document lifecycle must reset what Command derived from the previous document: loading, ' +
            'resetting and preparing a document reset the action replay authority, a branch switch captures, ' +
            'clears and restores undo history, and the slot projection reads the command batch idempotency store.',
        retiredBy:
            'A kernel decision to route the document-lifecycle calls into Command through ports CrdtDocument ' +
            'declares and src/app fills, as sessionUndoWitnessStampPort already does, or to merge the two kernels.',
    },
];

// Each entry is one upward module pair the gate accepts, with the reason read
// from the imports that produce it.
const acceptedTierEdges = [
    {
        from: 'AiRuntime',
        to: 'WorkspaceShell',
        reason:
            'The model context reports the active workspace mode and its cache keys on workspaceStore identity ' +
            '(getProjectContext), and the chat actions open the shell-owned chat panel, reading chatPanelOpen ' +
            'and calling toggleChatPanel (toggleChat, openAnswerInChat). Panel layout and mode are shell state.',
    },
    {
        from: 'Arrangement',
        to: 'ElasticAudio',
        reason:
            "Arrangement's transient-detection command handler orchestrates the Arrangement-owned warp-marker " +
            'capture and delegates onset analysis to the ElasticAudio use case through the useCases barrel, ' +
            'which owns the transient lifecycle over Arrangement-owned markers. It retires when the handler ' +
            'moves to an ElasticAudio handler map registered in src/app/bootstrap.ts, the same retirement as ' +
            'the AudioEngine edge below.',
    },
    {
        from: 'AudioEngine',
        to: 'Arrangement',
        reason:
            'The live, offline, recording, latency-compensation and adjustment-bus paths read the track, ' +
            'take-lane, gain-envelope, solo, VCA and adjustment-layer stores to build the graph they run. Part ' +
            'of the core cycle that ADR 0011 redraws.',
    },
    {
        from: 'AudioEngine',
        to: 'Automation',
        reason:
            'Offline render and the native live automation writer read automation and modulation stores, the ' +
            'lane ceiling and offline modulator plans to play automation. Part of the core cycle that ADR 0011 ' +
            'redraws.',
    },
    {
        from: 'AudioEngine',
        to: 'ElasticAudio',
        reason:
            "AudioEngine's final-feature handler map still hosts the elastic-editor action handlers, which call " +
            'ElasticAudio use cases and read elasticAudioStore; it retires when those handlers move to an ' +
            'ElasticAudio handler map registered in src/app/bootstrap.ts.',
    },
    {
        from: 'AudioEngine',
        to: 'MIDI',
        reason:
            'Offline render and the live MIDI programme read MIDI notes, frozen MIDI takes, groove templates and ' +
            'the chord track to schedule notes. Part of the core cycle that ADR 0011 redraws.',
    },
    {
        from: 'AudioEngine',
        to: 'Routing',
        reason:
            'Latency compensation, offline track subgraphs and stem export read sidechainStore to wire and delay ' +
            'sidechain sources. Part of the core cycle that ADR 0011 redraws.',
    },
    {
        from: 'AudioEngine',
        to: 'Transport',
        reason:
            'Live playback, offline render, recording and deadline evidence read the transport state, tempo map ' +
            'and time-signature map and convert beats, seconds and samples through them. Part of the core cycle ' +
            'that ADR 0011 redraws.',
    },
    {
        from: 'CommandInterface',
        to: 'WorkspaceShell',
        reason:
            'The palette and keyboard shortcuts are the input surface for shell operations: they open shell ' +
            'dialogs and panels, set and swap the editing tool, zoom to fit or selection, switch workspace mode, ' +
            'and read workspaceStore to route Escape. Those operations are owned by the shell that mounts them.',
    },
];

module.exports = { tiers, modules, allowedCycles, acceptedTierEdges };
