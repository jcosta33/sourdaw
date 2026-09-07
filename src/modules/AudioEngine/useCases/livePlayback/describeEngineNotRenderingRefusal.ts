import { ENGINE_NOT_RENDERING_PREFIX } from './engineNotRenderingRefusal';

/**
 * The prose after an `engine-not-rendering:` refusal's machine prefix,
 * trimmed.
 *
 * `abandonNativeLiveGraphSession` puts its `reason` argument straight into a
 * notice a musician reads, and the raw refusal string carries a prefix that
 * exists only for `isEngineNotRenderingRefusal` to match on — not for a
 * musician to see. Only meaningful on a reason that check has already said
 * yes to; a caller that has not made that check has nothing here to strip.
 */
export function describeEngineNotRenderingRefusal(reason: string): string {
    return reason.slice(ENGINE_NOT_RENDERING_PREFIX.length).trim();
}
