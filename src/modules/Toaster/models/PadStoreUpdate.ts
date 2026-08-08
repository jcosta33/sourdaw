import { type PadState } from './ToasterKit';

/** Every `PadState` field the model types as a boolean, read off the model itself. */
type BooleanPadField = { [Key in keyof PadState]: PadState[Key] extends boolean ? Key : never }[keyof PadState];

/** Every `PadState` field the model types as a string, read off the model itself. */
type StringPadField = { [Key in keyof PadState]: PadState[Key] extends string ? Key : never }[keyof PadState];

/**
 * The boolean pad fields, enumerated from `PadState` rather than listed by hand:
 * this is a total `Record`, so adding a boolean field to the model without
 * deciding what it does here is a compile error rather than a silent omission.
 */
const BOOLEAN_PAD_FIELDS: Record<BooleanPadField, true> = { muted: true, soloed: true };

/**
 * The string pad fields, enumerated the same way. A numeric wire value carries
 * no string, so these are dropped rather than written.
 */
const STRING_PAD_FIELDS: Record<StringPadField, true> = { engineType: true, name: true, color: true };

const BOOLEAN_FIELDS = new Set<string>(Object.keys(BOOLEAN_PAD_FIELDS));
const STRING_FIELDS = new Set<string>(Object.keys(STRING_PAD_FIELDS));

type ToPadStoreUpdateInput = {
    key: keyof PadState;
    value: number;
};

/**
 * Translate one numeric pad-param write into the store patch it should become,
 * or `undefined` when the field takes no numeric write at all.
 *
 * The two sides of a pad param speak different types for the same control. The
 * engine's pad params are uniformly numeric on the wire (`Pad::set_param` in
 * `crates/daw-dsp/src/toaster/pad.rs` reads mute as `value > 0.5`), while the
 * store field is a boolean that the persisted kit chunk only accepts as one —
 * `readPads` in `ToasterKitState.ts` gates on `typeof stored.muted === 'boolean'`.
 * Writing the raw 1 into the store would leave the pad muted for this session
 * and unmuted on the next project load.
 *
 * This lives in `models/` because both pad-param entry points need it — the
 * rAF-coalesced `setToasterPadParam` and the synchronous `setPadParamImmediate`
 * — and a field table maintained twice is a field table that drifts.
 */
export function toPadStoreUpdate(input: ToPadStoreUpdateInput): Partial<PadState> | undefined {
    const { key, value } = input;
    if (BOOLEAN_FIELDS.has(key)) {
        return { [key]: value > 0 };
    }
    if (STRING_FIELDS.has(key)) {
        return undefined;
    }
    return { [key]: value };
}
