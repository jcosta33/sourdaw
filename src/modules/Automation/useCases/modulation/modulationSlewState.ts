/**
 * Per-(track,device,param) exponential slew state for the modulation->engine
 * write, mirroring `applyAutomation`'s slew so the modulation path produces the
 * same smooth ramps instead of stepping the param every tick (zipper noise).
 */
export const modulationParamSlew = new Map<string, number>();

/**
 * The scheduler discontinuity epoch observed on the previous modulation tick.
 * When it advances (seek, loop-wrap, follow-action jump) the next apply snaps
 * every modulated target instead of gliding from the pre-jump smoothed value —
 * the modulation analog of `applyAutomation`'s slew reset. `undefined` until the
 * first tick that carries an epoch.
 */
export const modulationSlewEpoch: { last: number | undefined } = { last: undefined };
