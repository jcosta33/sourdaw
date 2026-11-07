import { type getMixRecipeCatalog, quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';

type MixRecipeParameter = ReturnType<
    typeof getMixRecipeCatalog
>['recipes'][number]['steps'][number]['parameters'][number];

/** Enough significant digits for any authored window, few enough to drop float noise like 0.44999999999999996. */
const MIDPOINT_SIGNIFICANT_DIGITS = 12;

/**
 * The value a parameter takes when none is supplied: the middle of its window, resolved onto the
 * descriptor's own legal settings so a discrete parameter never lands between two of them. An exact
 * window (a recipe published from a preset) holds one value, which is taken as stored: rounding it to
 * the midpoint's precision would move a long-precision stored value out of its own window.
 */
export function chooseRecipeMidpoint(deviceType: string, parameter: MixRecipeParameter): number {
    if (parameter.minimum === parameter.maximum) {
        return quantiseDeviceParameterValue({ deviceType, paramId: parameter.paramId, value: parameter.minimum });
    }
    const midpoint = Number(((parameter.minimum + parameter.maximum) / 2).toPrecision(MIDPOINT_SIGNIFICANT_DIGITS));
    return quantiseDeviceParameterValue({ deviceType, paramId: parameter.paramId, value: midpoint });
}
