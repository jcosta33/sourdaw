import { isComplexPrompt as parseComplexPrompt } from '../../transformers/promptParser/parsing';

export function isComplexPrompt(normalized: string): boolean {
    return parseComplexPrompt(normalized);
}
