import { STYLE_TO_ALGORITHM } from './helpers';

export function algorithmFromStyle(style: string): (typeof STYLE_TO_ALGORITHM)[keyof typeof STYLE_TO_ALGORITHM] | null {
    if (style === 'transparent' || style === 'punchy' || style === 'loud') {
        return STYLE_TO_ALGORITHM[style];
    }

    return null;
}
