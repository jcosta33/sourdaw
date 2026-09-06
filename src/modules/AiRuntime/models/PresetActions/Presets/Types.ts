import { type ProjectContext } from '../../ProjectContext';
import { type RuntimeAction } from '../../RuntimeAction';

// ── Context passed to every preset builder ──────────────────────────────

export type PresetContext = {
    selectedTrackId: string | undefined;
    selectedTrackKind?: ProjectContext['tracks'][number]['kind'];
    selectedClipId: string | undefined;
    selectedClipType: 'audio' | 'midi' | undefined;
    trackCount: number;
};

// ── Preset definition ───────────────────────────────────────────────────

export type PresetAction = {
    id: string;
    label: string;
    /** Search terms & common aliases — fuzzy matched against user input */
    keywords: string[];
    /** Complete imperative synonyms eligible for exact deterministic execution. */
    commandAliases?: string[];
    category: PresetCategory;
    /** What must be selected for this preset to be available */
    requiresSelection?: 'track' | 'clip' | 'clipMidi' | 'clipAudio';
    /** Whether this action is destructive (requires confirmation) */
    isDestructive?: boolean;
    /** Build the AppAction(s). Return `null` to indicate the preset is not applicable. */
    buildAction: (ctx: PresetContext) => RuntimeAction | RuntimeAction[] | null;
};

export type PresetCategory =
    | 'Transport'
    | 'Track'
    | 'Clip'
    | 'MIDI'
    | 'Device'
    | 'Workspace'
    | 'Mix'
    | 'Generate'
    | 'File'
    | 'Automation'
    | 'Collaboration';

// ── Helpers ─────────────────────────────────────────────────────────────

export function trackAction(
    type: RuntimeAction['type'],
    payloadFn: (trackId: string) => Record<string, unknown>
): PresetAction['buildAction'] {
    return (ctx) => {
        if (!ctx.selectedTrackId) {
            return null;
        }
        return { type, payload: payloadFn(ctx.selectedTrackId) } as RuntimeAction;
    };
}

export function clipAction(
    type: RuntimeAction['type'],
    payloadFn: (clipId: string) => Record<string, unknown>
): PresetAction['buildAction'] {
    return (ctx) => {
        if (!ctx.selectedClipId) {
            return null;
        }
        return { type, payload: payloadFn(ctx.selectedClipId) } as RuntimeAction;
    };
}
