export const GENERATED_BEGIN: string;
export const GENERATED_END: string;
export function renderGeneratedRegion(data: unknown): string;
export function replaceGeneratedRegion(markdown: string, data: unknown): string;
export function assertGeneratedRegionMatches(markdown: string, data: unknown): void;
