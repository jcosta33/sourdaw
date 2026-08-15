import { trackStore } from '#/modules/Arrangement/stores';
import { summarizeFeatures } from '#/modules/AudioAnalysis/useCases';

import { streamHostedModelText } from './streamHostedModelText';

/**
 * LLM-backed mix health report. Lives in AiRuntime because the primary
 * concern is AI explanation/tutoring; AudioAnalysis provides the raw feature
 * summary as input. Placed here (not AudioAnalysis) to avoid the
 * `AudioAnalysis ↔ AiRuntime` barrel cycle — AiRuntime can depend on
 * AudioAnalysis for pure analysis primitives, but AudioAnalysis should not
 * statically reach into AiRuntime's LLM orchestration.
 */
type MixHealthAnalysisInput = {
    onToken: (text: string) => void;
    signal?: AbortSignal;
};

export async function mixHealthAnalysis({ onToken, signal }: MixHealthAnalysisInput): Promise<void> {
    const tracks = trackStore.value?.tracks;
    if (!tracks || tracks.length === 0) {
        onToken('No tracks found in the session to analyze.');
        return;
    }

    let reportPayload = 'Mix Data Overview:\\n\\n';

    for (const track of tracks) {
        if (track.kind === 'folder') {
            continue;
        }

        let trackSummary = '';
        let audioAnalyzed = false;

        const audioClip = track.clips.find((context) => context.type === 'audio' && context.audioBufferId);
        if (audioClip && audioClip.audioBufferId) {
            const features = summarizeFeatures(audioClip.audioBufferId);
            if (features) {
                trackSummary += `  - RMS Profile: Peak ${(features.peakRms * 100).toFixed(1)}%, Avg ${(features.avgRms * 100).toFixed(1)}%\\n`;
                trackSummary += `  - Brightness: ${features.avgSpectralCentroid.toFixed(0)} Hz\\n`;
                trackSummary += `  - Tonal vs Noise: ${features.avgSpectralFlatness < 0.3 ? 'Tonal' : 'Noisy'}\\n`;
                audioAnalyzed = true;
            }
        }

        reportPayload += `Track: ${track.name} (${track.kind})\\n`;
        reportPayload += `  - Gain: ${(track.gain * 100).toFixed(0)}%, Pan: ${track.pan}\\n`;
        if (audioAnalyzed) {
            reportPayload += trackSummary;
        } else {
            reportPayload += `  - Note: Source material not analyzed directly (MIDI or unrendered).\\n`;
        }
    }

    const systemPrompt = `You are a world-class mixing engineer and music mentor. You are provided with statistical data extracted from the tracks in a user's DAW session.

Based on this data, provide constructive, actionable feedback to improve the mix.

Format your response in Markdown with TWO main sections:
### Mix Analysis
(Bullet points with specific feedback on frequency masking, gain staging, panning conflicts, etc).

### Educational Insights (Why this matters)
(Mentor the user. Explain the audio engineering principles behind your feedback. e.g. Why is headroom important? What causes mud in the low end? Be encouraging but highly academic).

Keep your response concise. Do not mention the raw numbers heavily unless necessary; focus on musical and mixing advice.`;

    const outcome = await streamHostedModelText({
        correlationId: `mix-health-${crypto.randomUUID()}`,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: reportPayload },
        ],
        maxOutputTokens: 1_000,
        onToken,
        signal,
    });
    if (outcome.status !== 'complete') {
        throw new Error(outcome.failure?.safeMessage ?? 'Hosted AI mix analysis did not complete.');
    }
}
