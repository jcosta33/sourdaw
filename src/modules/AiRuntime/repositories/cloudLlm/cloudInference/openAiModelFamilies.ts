export function isOpenAiReasoningModel(model: string): boolean {
    return model.startsWith('gpt-5') || /^o\d/.test(model);
}
