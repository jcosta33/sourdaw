import { nativeBuiltinBody } from './nativeBuiltinBodies';

/**
 * The renderer's reading of `BuiltinEffectType::sounds_notes` (#3893). A
 * hosted plugin's type resolves no body here, so this answers only for
 * built-ins.
 */
export function soundsNativeNotes(deviceType: string): boolean {
    return nativeBuiltinBody(deviceType)?.soundsNotes === true;
}
