/**
 * Automation lanes that drive a track's own fader and panner rather than a
 * device parameter.
 *
 * Named once because two places have to agree on the set: the strip seed, which
 * decides whether those nodes carry the stored value, and the offline automation
 * filter, which decides whether their lanes are scheduled. A render that
 * neutralised the nodes but still scheduled their lanes would bake the moves
 * whose static value it had just excluded.
 */
export const MIXER_AUTOMATION_PARAMETER_IDS = ['gain', 'pan'] as const;
