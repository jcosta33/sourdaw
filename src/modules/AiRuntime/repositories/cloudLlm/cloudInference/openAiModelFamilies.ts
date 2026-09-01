export function isGpt56FamilyModel(model: string): boolean {
    return model === 'gpt-5.6' || model.startsWith('gpt-5.6-');
}
