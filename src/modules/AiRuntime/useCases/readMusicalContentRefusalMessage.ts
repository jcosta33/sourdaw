const MUSICAL_CONTENT_REFUSAL_MESSAGES = new Map([
    ['Stale musical content revision', 'Musical evidence is stale; start a fresh request.'],
    ['Stale musical selection', 'MIDI selection changed; start a fresh request.'],
    ['Ambiguous piano roll selection', 'Selected note identity is ambiguous; narrow the selection.'],
    ['Piano roll selection unavailable', 'Selected note ownership is unavailable; reselect the notes.'],
    ['MIDI projection work budget exceeded', 'Musical read exceeds its work budget; narrow the window.'],
    ['MIDI projection output budget exceeded', 'Musical read exceeds its output budget; narrow the window.'],
    ['Musical content row budget exceeded', 'Musical read has too many rows; narrow the window.'],
    ['Musical content chord budget exceeded', 'Musical read exceeds its chord-source budget.'],
    ['Musical content text exceeds receipt limit', 'Musical read contains text too large for a receipt.'],
    ['Invalid or stale semantic query cursor', 'Musical page cursor is stale or invalid; start a fresh request.'],
]);

export function readMusicalContentRefusalMessage(message: string): string | undefined {
    return MUSICAL_CONTENT_REFUSAL_MESSAGES.get(message);
}
