import { createAiGenerationError } from '../errors/AiGenerationError';
import { createAlternativeClips, getTrackStoreState as getTrackState } from '#/modules/Arrangement/useCases';
import { streamCloudChatCompletion } from '#/modules/AiRuntime/useCases';
import { getNotesForClip } from '#/modules/MIDI/useCases';
// Consumer-local shape (AGENTS.md §95 — model isolation). Only the fields used here.
type Clip = { id: string; type: 'audio' | 'midi'; startBeat: number; endBeat: number };

export async function generateMidiVariations(clipId: string): Promise<void> {
    const state = getTrackState();
    if (!state) {
        return;
    }

    let targetClip: Clip | null = null;

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            targetClip = clip;
            break;
        }
    }

    if (!targetClip || targetClip.type !== 'midi') {
        throw createAiGenerationError('Target clip must be a MIDI clip.');
    }

    const notes = getNotesForClip(targetClip.id);
    if (!notes || notes.length === 0) {
        throw createAiGenerationError('MIDI clip has no notes to vary.');
    }

    const startBeat = targetClip.startBeat;
    const endBeat = targetClip.endBeat;
    const duration = endBeat - startBeat;

    // Build representation of current notes (relative to clip start)
    const noteStrings = notes
        .map(
            (n) =>
                `[pitch=${n.pitch}, start=${(n.startBeat - startBeat).toFixed(2)}, duration=${n.duration.toFixed(2)}, velocity=${n.velocity.toFixed(2)}]`
        )
        .join(', ');

    const projectContext = `We have a MIDI clip of length ${duration} beats. Current notes (relative to start): ${noteStrings}`;

    const prompt = `Generate 3 completely unique musical variations of these MIDI notes. Keep the total length exactly ${duration} beats. Keep them in the same key.
Return ONLY valid JSON matching this schema:
{ "variations": [ [ { "pitch": number, "startBeat": number, "duration": number, "velocity": number } ] ] }
Variation 1: Add syncopation and slight rhythm changes.
Variation 2: Add passing notes and embellishments.
Variation 3: Simplify the rhythm but keep the core harmonic rhythm.
ONLY output raw JSON, no markdown blocks.`;

    let responseStr = '';
    await streamCloudChatCompletion(
        [
            { role: 'system', content: 'You are a world-class generative MIDI AI.' },
            { role: 'user', content: `${projectContext}\\n\\n${prompt}` },
        ],
        (token: string) => {
            responseStr += token;
        },
        { maxTokens: 4000 }
    );

    try {
        // Extract JSON object from potentially markdown-wrapped response
        const jsonMatch = responseStr.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw createAiGenerationError('No JSON object found in AI response');
        }
        const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        if (data && Array.isArray(data.variations)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM output, validated by createAlternativeClips
            createAlternativeClips(targetClip.id, data.variations as any);
        }
    } catch (error) {
        throw createAiGenerationError(
            `Failed to parse variations from AI: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
