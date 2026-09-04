export const MAX_EXECUTABLE_APP_ACTION_INTENT_CATALOG_INTENT_LENGTH = 512;

export function getExecutableAppActionIntentCatalogUnicodeLength(intent: string): number {
    return Array.from(intent).length;
}
