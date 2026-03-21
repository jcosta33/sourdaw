import { type ProjectContext } from '../models/ProjectContext';
import { type PromptFormat, buildSystemPrompt } from './systemPrompt';
import { mcpToCompactPromptText } from './mcpToolAdapter';
import { getNativeToolsPrompt } from '../repositories/nativeToolRegistry';

// Cache native tools prompt — it doesn't change at runtime
let cachedNativeToolsPrompt: string | null = null;

/**
 * Async version that includes native (Rust-side) plugin tool schemas.
 *
 * Prefer this when the caller can await (use cases, event handlers).
 */
export async function buildActionSystemPromptAsync(
    context: ProjectContext,
    format: PromptFormat = 'api'
): Promise<string> {
    const toolsJson = mcpToCompactPromptText();

    // Fetch native tools once and cache
    if (cachedNativeToolsPrompt === null) {
        cachedNativeToolsPrompt = await getNativeToolsPrompt();
    }

    const combinedTools = cachedNativeToolsPrompt
        ? `${toolsJson}\n\n# Native Plugin Tools\n${cachedNativeToolsPrompt}`
        : toolsJson;

    const projectState = buildProjectState(context);
    return buildSystemPrompt(combinedTools, projectState, format);
}

// ── Project state serialisation ─────────────────────────────────────────

const MAX_TRACKS = 16;
const MAX_CLIPS_PER_TRACK = 6;
const MAX_DEVICES_PER_TRACK = 6;

function formatTrackLine(t: ProjectContext['tracks'][number], index: number): string {
    let line = `${String(index + 1)}. id="${t.id}" name="${t.name}" ${t.kind} muted=${String(t.muted)} solo=${String(t.soloed)} armed=${String(t.armed)} gain=${String(t.gain)} pan=${String(t.pan)}`;

    if (t.clips.length > 0) {
        const shown = t.clips.slice(0, MAX_CLIPS_PER_TRACK);
        const clipStr = shown
            .map(
                (c) =>
                    `${c.id}:${c.name}(${String(c.startBeat)}-${String(c.endBeat)}${c.noteCount > 0 ? `,${String(c.noteCount)}notes` : ''})`
            )
            .join(',');
        const overflow =
            t.clips.length > MAX_CLIPS_PER_TRACK ? `...+${String(t.clips.length - MAX_CLIPS_PER_TRACK)}more` : '';
        line += ` clips:[${clipStr}${overflow}]`;
    }

    if (t.devices.length > 0) {
        const shown = t.devices.slice(0, MAX_DEVICES_PER_TRACK);
        const devStr = shown.map((d) => `${d.id}:${d.type}${d.bypassed ? '(BYP)' : ''}`).join(',');
        const overflow =
            t.devices.length > MAX_DEVICES_PER_TRACK
                ? `...+${String(t.devices.length - MAX_DEVICES_PER_TRACK)}more`
                : '';
        line += ` devices:[${devStr}${overflow}]`;
    }

    return line;
}

function buildProjectState(context: ProjectContext): string {
    const truncated = context.tracks.slice(0, MAX_TRACKS);
    const overflow = context.tracks.length > MAX_TRACKS;

    const trackList =
        truncated.length > 0
            ? truncated.map((t, i) => formatTrackLine(t, i)).join('\n') +
              (overflow ? `\n(+${String(context.tracks.length - MAX_TRACKS)} more tracks not shown)` : '')
            : '(empty session — no tracks yet)';

    const selectedClips =
        context.selectedClipIds.length > 0 ? ` | All Selected Clips: ${context.selectedClipIds.join(',')}` : '';

    return `PROJECT STATE:
Tempo: ${String(context.tempo)} BPM | Time: ${String(context.timeSignature[0])}/${String(context.timeSignature[1])} | Playhead: beat ${String(Math.round(context.playheadPosition))} | View: ${context.activeView}
Selected Track: ${context.selectedTrackId ?? 'none'} | Selected Clip: ${context.selectedClipId ?? 'none'}${selectedClips}

Tracks:
${trackList}`;
}
