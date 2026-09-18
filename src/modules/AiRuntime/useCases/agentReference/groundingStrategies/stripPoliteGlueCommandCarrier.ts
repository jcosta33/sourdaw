export function stripPoliteGlueCommandCarrier(text: string): string {
    let commandSource = text.trim();
    commandSource = commandSource.replace(/^(?:please\s+)?(?:can|could|would|will)\s+you(?:\s+please)?\s+/iu, '');
    commandSource = commandSource.replace(/^please\s+/iu, '');
    return commandSource.replace(/\s+(?:please|thanks|thank you)[.!?]*\s*$/iu, '');
}
