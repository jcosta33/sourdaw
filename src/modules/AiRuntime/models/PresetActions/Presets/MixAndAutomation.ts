import { type PresetAction } from './Types';

export const mixPresets: readonly PresetAction[] = [
    {
        id: 'analyze-mix',
        label: 'Analyze Mix',
        keywords: ['analyze mix', 'check mix', 'mix analysis', 'loudness check'],
        category: 'Mix',
        buildAction: () => ({ type: 'analyzeMix' }),
    },
    {
        id: 'autofix-mix',
        label: 'Auto-Fix Mix',
        keywords: ['fix mix', 'auto fix', 'auto-fix mix', 'balance mix', 'auto level'],
        category: 'Mix',
        buildAction: () => ({ type: 'autoFixMix' }),
    },
    {
        id: 'consolidate-all',
        label: 'Consolidate All Tracks',
        keywords: ['consolidate all', 'bounce all', 'render all'],
        category: 'Mix',
        buildAction: () => ({ type: 'consolidateAllTracks' }),
    },
    {
        id: 'latency-report',
        label: 'Show Latency Report',
        keywords: ['latency', 'latency report', 'audio latency'],
        category: 'Mix',
        buildAction: () => ({ type: 'getLatencyReport' }),
    },
];

export const automationPresets: readonly PresetAction[] = [
    {
        id: 'add-auto-lane',
        label: 'Add Automation Lane',
        keywords: ['automation lane', 'add automation', 'automation'],
        category: 'Automation',
        requiresSelection: 'track',
        // Parameter and target grounding belong to the provider tool bridge.
        // Keeping this searchable but non-executable prevents the legacy fuzzy
        // fast path from inventing a default lane and bypassing that validation.
        buildAction: () => null,
    },
    {
        id: 'invert-auto',
        label: 'Invert Automation',
        keywords: ['invert automation', 'flip automation'],
        category: 'Automation',
        buildAction: () => null,
    },
    {
        id: 'thin-auto',
        label: 'Thin Automation Points',
        keywords: ['thin automation', 'reduce points', 'simplify automation'],
        category: 'Automation',
        buildAction: () => null,
    },
];
