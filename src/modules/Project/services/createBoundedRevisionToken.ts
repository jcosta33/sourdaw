/**
 * A fixed-width revision token over a revision and the content signed under it.
 *
 * Two independent hashes are combined so that two signatures colliding in one of
 * them still produce different tokens. The token is bounded whatever the
 * signature's length, which is what lets a receipt carry it and a cursor be
 * bound to it. The separator is a code point no signature contains, so
 * `a` + `bc` and `ab` + `c` cannot hash alike.
 */
const SIGNATURE_SEPARATOR = String.fromCodePoint(0);

export function createBoundedRevisionToken(revision: string, signature: string): string {
    let fnv = 2_166_136_261;
    let djb = 5_381;
    for (const character of `${revision}${SIGNATURE_SEPARATOR}${signature}`) {
        const codePoint = character.codePointAt(0) ?? 0;
        fnv = Math.imul(fnv ^ codePoint, 16_777_619);
        djb = Math.imul(djb, 33) ^ codePoint;
    }
    return `spq1.${(fnv >>> 0).toString(36)}.${(djb >>> 0).toString(36)}`;
}
