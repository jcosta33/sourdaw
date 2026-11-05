import { setSnapValue as setTimelineSnapValue } from '#/modules/Arrangement/useCases';

export const setSnapValue = (value: number): void => {
    setTimelineSnapValue(value);
};
