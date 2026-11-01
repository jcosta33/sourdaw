/* SPDX-FileCopyrightText: Copyright Sourdaw Ltd. */
/* SPDX-License-Identifier: Apache-2.0 */

// ----------------------------------------------------------------------------
// Module tier manifest: the single source for where each src/modules/<Module>
// sits and which tiers it may depend on. scripts/check-dependency-boundaries.mjs
// reads it for the `moduleTiers` gate, which compares every non-presentation
// cross-module edge against these rules and reports every module-level cycle
// against an exact baseline.
//
// A module's tier follows its role — its ADR 0011 subdomain kind, its own
// AGENTS.md and the aggregate it owns — never today's import graph, so an
// upward edge shows up as a baseline row instead of being blessed here.
// Same-tier edges are always allowed; cycles among them are caught separately.
// A new cross-tier dependency is argued in review as a change to this file,
// never admitted by rewriting the baseline.
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

module.exports = { tiers, modules };
