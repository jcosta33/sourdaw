/**
 * The closed forms a protection takes beside `leave`/`keep` … `unchanged`, `as is` or `as proposed`,
 * in normalized words, each stating its object once: `leave`/`keep` <object> `untouched` or `the same`,
 * <object> [`stays`, `remains`] `untouched`, `unchanged`, `the same` or `as is`, and `no change(s) to`
 * <object>.
 */
const PROTECTION_FORMS: readonly RegExp[] = [
    /^(?:leave|leaving|keep|keeping)\s+(.+?)\s+(?:untouched|the\s+same)$/u,
    /^(.+?)\s+(?:(?:stays|stay|remains|remain)\s+)?(?:untouched|unchanged|the\s+same|as\s+(?:it\s+)?is)$/u,
    /^no\s+changes?\s+to\s+(.+)$/u,
];
/** The object a protection names when it keeps the rest of the mix as it is, naming nothing. */
const REST_OF_MIX = /^(?:everything\s+else|anything\s+else|all\s+else|the\s+rest)$/u;

/**
 * What a whole clause, in normalized words, protects in one of the closed forms: the rest of the mix,
 * or the object text it states; `null` when it takes none of them.
 */
function readProtectionForm(words: string): { kind: 'rest' } | { kind: 'object'; stated: string } | null {
    const stated = PROTECTION_FORMS.map((form) => form.exec(words)?.[1]).find((object) => object !== undefined);
    if (stated === undefined) {
        return null;
    }
    return REST_OF_MIX.test(stated) ? { kind: 'rest' } : { kind: 'object', stated };
}

/** How a refinement clause reads as a protection in one of the closed forms beyond `leave`/`keep` … `unchanged`. */
export const refinementProtectionForms = {
    read: readProtectionForm,
} as const;
