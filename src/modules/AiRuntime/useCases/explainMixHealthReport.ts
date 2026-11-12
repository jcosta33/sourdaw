import { runMixHealthModelText } from './runMixHealthModelText';

type ExplainMixHealthReportInput = {
    report: string;
    onToken: (text: string) => void;
    signal?: AbortSignal;
};

const ELI5_MAX_OUTPUT_TOKENS = 2_048;

/** Restates a finished Mix Health report for a beginner, on the same backend rule as the report. */
export async function explainMixHealthReport({ report, onToken, signal }: ExplainMixHealthReportInput): Promise<void> {
    await runMixHealthModelText({
        correlationId: `mix-health-eli5-${crypto.randomUUID()}`,
        systemPrompt: 'You are a patient music teacher for beginners.',
        userMessage: `Here is a technical mix analysis:\n\n${report}\n\nPlease explain this to me like I am a 5 year old beginner. Focus entirely on simple analogies.`,
        maxOutputTokens: ELI5_MAX_OUTPUT_TOKENS,
        onToken,
        signal,
    });
}
