/**
 * Selects the most relevant tools for a given prompt to stay within
 * the LLM's context window. 125+ tools × ~75 tokens each = ~9K tokens,
 * which overflows a 4-8K context. This selector picks ≤30 tools.
 */

import { type RuntimeActionType } from '../models/RuntimeAction';
import { type ToolSchema } from '../models/Tools/Types';

const MAX_TOOLS = 30;

/**
 * Core tools always included — these cover the most common operations.
 *
 * Typed as `ReadonlySet<RuntimeActionType>` so every entry must be a real
 * runtime action name. A typo (e.g. a tool that doesn't exist in
 * `RuntimeActionType` / `DAW_TOOL_SCHEMAS`) is a compile error rather than a
 * silently-dropped name that still consumes a `MAX_TOOLS` budget slot.
 */
const CORE_TOOLS: ReadonlySet<RuntimeActionType> = new Set<RuntimeActionType>([
    'addTrack',
    'removeTrack',
    'setTrackGain',
    'setTrackPan',
    'muteTrack',
    'soloTrack',
    'setTempo',
    'addTimeSignatureChange',
    'togglePlayback',
    'stopPlayback',
    'addClip',
    'removeClip',
    'addDevice',
    'removeDevice',
    'addNotes',
]);

/** Keyword → tool name mapping for context-relevant selection. */
const KEYWORD_TOOLS: Array<{ keywords: RegExp; tools: string[] }> = [
    {
        keywords: /track|session|setup|song|project/i,
        tools: [
            'addTrack',
            'removeTrack',
            'duplicateTrack',
            'setTrackGain',
            'setTrackPan',
            'muteTrack',
            'soloTrack',
            'armTrack',
            'renameTrack',
            'setTrackColor',
        ],
    },
    {
        keywords: /midi|note|chord|melody|bass|drum|pattern|riff|beat/i,
        tools: [
            'addNotes',
            'completeMidi',
            'variationMidi',
            'generateBassline',
            'generateDrumPattern',
            'generateMelody',
            'generateChordProgression',
            'quantizeNotes',
            'transposeNotes',
        ],
    },
    {
        keywords: /mix|volume|loud|quiet|gain|pan|level|balance/i,
        tools: ['setTrackGain', 'setTrackPan', 'muteTrack', 'soloTrack', 'analyzeMix', 'autoFixMix'],
    },
    {
        keywords: /effect|plugin|device|reverb|delay|compress|eq|filter|distort|saturate|chorus|flanger|phaser/i,
        tools: ['addDevice', 'removeDevice', 'setDeviceParameter', 'bypassDevice'],
    },
    {
        keywords: /tempo|bpm|speed|faster|slower/i,
        tools: ['setTempo'],
    },
    {
        keywords: /automat|envelope|curve|fade/i,
        tools: [
            'addAutomationLane',
            'addAutomationPoint',
            'removeAutomationPoint',
            'setAutomationLaneEnabled',
            'setAutomationMode',
            'scaleAutomation',
            'stretchAutomation',
            'invertAutomation',
            'reverseAutomation',
            'thinAutomation',
            'quantizeAutomation',
        ],
    },
    {
        keywords: /record|arm|punch|take/i,
        tools: ['armTrack', 'toggleRecording', 'setPunchIn', 'setPunchOut'],
    },
    {
        keywords: /route|send|bus|sidechain/i,
        tools: ['addSend', 'removeSend', 'addSidechainRoute', 'removeSidechainRoute', 'setTrackOutput'],
    },
    {
        keywords: /marker|section|structure|arrange/i,
        tools: ['addMarker', 'removeMarker', 'addSection', 'removeSection'],
    },
    {
        keywords: /clip|split|trim|move|duplicate|copy|paste/i,
        tools: [
            'addClip',
            'removeClip',
            'splitClip',
            'moveClip',
            'duplicateClip',
            'duplicateClipToNextBar',
            'renameClip',
        ],
    },
    {
        keywords: /stem|separate|vocal|instrumental/i,
        tools: ['stemSeparate'],
    },
    {
        keywords: /generat|create|audio|sound/i,
        tools: ['generateAudio', 'generateDrumPattern', 'generateMelody', 'generateChordProgression'],
    },
    {
        keywords: /time|insert|delete|range/i,
        tools: ['insertTime', 'deleteTime', 'duplicateTimeRange'],
    },
    {
        keywords: /key|scale|transpose/i,
        tools: ['transposeNotes', 'detectKey'],
    },
];

/**
 * Select the most relevant tools for a prompt.
 * Always includes CORE_TOOLS, then adds context-relevant tools up to MAX_TOOLS.
 */
export function selectToolsForPrompt(allTools: readonly ToolSchema[], userPrompt: string): ToolSchema[] {
    const selected = new Set<string>(CORE_TOOLS);

    // Add keyword-matched tools
    for (const { keywords, tools } of KEYWORD_TOOLS) {
        if (keywords.test(userPrompt)) {
            for (const time of tools) {
                selected.add(time);
            }
        }
    }

    // If nothing specific matched, include generation + arrangement tools
    if (selected.size <= CORE_TOOLS.size) {
        for (const { tools } of KEYWORD_TOOLS) {
            for (const time of tools) {
                selected.add(time);
                if (selected.size >= MAX_TOOLS) {
                    break;
                }
            }
            if (selected.size >= MAX_TOOLS) {
                break;
            }
        }
    }

    // Filter and cap
    const result = allTools.filter((time) => selected.has(time.function.name));
    return result.slice(0, MAX_TOOLS);
}
