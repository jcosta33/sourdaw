export function getSendAutomationBusId(parameterId: string): string | null {
    if (!parameterId.startsWith('send:')) {
        return null;
    }
    const busId = parameterId.slice('send:'.length);
    return busId.length > 0 ? busId : null;
}
