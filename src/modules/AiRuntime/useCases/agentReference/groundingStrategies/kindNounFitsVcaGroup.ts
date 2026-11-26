import { KIND_OBJECT } from '../protectionObjectForms';

/** Whether a track kind noun says what a VCA group is: "group" or "vca". */
export function kindNounFitsVcaGroup(kindNoun: string): boolean {
    return KIND_OBJECT[kindNoun] === 'group';
}
