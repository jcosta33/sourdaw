/** A figure stated to three decimals, so arithmetic noise (0.30000000000000004) never reaches prose. */
export const roundToThousandths = (value: number): number => {
    return Math.round(value * 1000) / 1000;
};
