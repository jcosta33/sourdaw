import { getCanonicalGrooveTemplateKey as getCanonicalKey } from '../../models/GrooveTemplate';

export function getCanonicalGrooveTemplateKey(value: string): string {
    return getCanonicalKey(value);
}
