import { STYLE_INDEX } from './helpers';

export function decodeCrustStyle(value: number | null | undefined): keyof typeof STYLE_INDEX | undefined {
    return (Object.keys(STYLE_INDEX) as (keyof typeof STYLE_INDEX)[]).find((style) => STYLE_INDEX[style] === value);
}
