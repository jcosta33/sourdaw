import { streamCloudChatCompletion } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
import { getTrackStoreState as getTrackState } from '#/modules/Arrangement/useCases/trackQueries';
import { getNotesForClip } from '#/modules/MIDI/useCases/midiNoteCrud';
import { createAlternativeClips } from '#/modules/Arrangement/useCases/clipEditingUseCases';
import { type Clip } from '#/modules/Arrangement/useCases/trackQueries';

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
        throw new Error('Target clip must be a MIDI clip.');
    }

    const notes = getNotesForClip(targetClip.id);
    if (!notes || notes.length === 0) {
        throw new Error('MIDI clip has no notes to vary.');
    }

    const startBeat = targetClip.startBeat;
    const endBeat = targetClip.endBeat;
    const duration = endBeat - startBeat;

    // Build representation of current notes (relative to clip start)
    const noteStrings = notes
        .map(
            (n: any) =>
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
        const cleanedStr = responseStr
            .trim()
            .replace(/^```json/, '')
            .replace(/```$/, '');
        const data = JSON.parse(cleanedStr);
        if (data && Array.isArray(data.variations)) {
            createAlternativeClips(targetClip.id, data.variations);
        }
    } catch (error) {
        console.error('Failed to parse AI variations:', error);
        throw new Error('Failed to parse variations from AI.');
    }
}
