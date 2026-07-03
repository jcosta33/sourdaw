/**
 * Per-(track,device,param) exponential slew state for the modulation->engine
 * write, mirroring `applyAutomation`'s slew so the modulation path produces the
 * same smooth ramps instead of stepping the param every tick (zipper noise).
 */
export const modulationParamSlew = new Map<string, number>();
