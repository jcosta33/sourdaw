import { digest } from '#/utils/canonicalDigest';

export function commandSourceDigest(kind: string, source: unknown): string {
    return digest({ version: 1, kind, source });
}
