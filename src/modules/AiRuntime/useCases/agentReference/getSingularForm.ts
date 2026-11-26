/** The singular of a plural English word ("buses" as "bus", "keys" as "key"), or null for one that reads as no plural. */
export function getSingularForm(word: string): string | null {
    if (word.endsWith('ies')) {
        return `${word.slice(0, -3)}y`;
    }
    if (/(?:s|x|z|ch|sh)es$/u.test(word)) {
        return word.slice(0, -2);
    }
    if (/[^siu]s$/u.test(word)) {
        return word.slice(0, -1);
    }
    return null;
}
