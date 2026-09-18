/**
 * What one hosted OpenAI stream returned, shared by both protocol families so a
 * caller cannot tell chat completions from responses by the shape it reads back.
 */
export type HostedOpenAiFinishReason = 'stop' | 'length' | 'refusal';

export type HostedOpenAiStreamResult = {
    finishReason: HostedOpenAiFinishReason;
    providerRequestId: string | null;
};
