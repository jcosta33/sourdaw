import {
    STRAIGHT_GROOVE_TEMPLATE_ID,
    getGrooveSubdivisionSlotCount,
    getGrooveSubdivisionStepBeats,
    type GrooveTemplate,
} from '../../models/GrooveTemplate';

type GrooveProjectableEvent = {
    id: string;
    startBeat: number;
    velocity: number;
};

type ApplyGrooveTemplateInput<Event extends GrooveProjectableEvent> = {
    events: readonly Event[];
    template: GrooveTemplate;
    amount: number;
};

export function applyGrooveTemplate<Event extends GrooveProjectableEvent>({
    events,
    template,
    amount,
}: ApplyGrooveTemplateInput<Event>): readonly Event[] {
    const clampedAmount = Math.max(0, Math.min(1, amount));
    if (template.id === STRAIGHT_GROOVE_TEMPLATE_ID || clampedAmount === 0 || template.slots.length === 0) {
        return events;
    }
    const stepBeats = getGrooveSubdivisionStepBeats(template.subdivision);
    const slotCount = getGrooveSubdivisionSlotCount(template.subdivision);
    const slots = new Map(template.slots.map((slot) => [slot.index, slot]));

    return events.map((event) => {
        const nearestStep = Math.round(event.startBeat / stepBeats);
        const slotIndex = ((nearestStep % slotCount) + slotCount) % slotCount;
        const slot = slots.get(slotIndex);
        if (!slot) {
            return event;
        }
        return {
            ...event,
            startBeat: Math.max(0, event.startBeat + slot.timingOffset * stepBeats * clampedAmount),
            velocity: Math.max(
                1,
                Math.min(127, Math.round(event.velocity + slot.dynamicsOffset * 127 * clampedAmount))
            ),
        };
    });
}
