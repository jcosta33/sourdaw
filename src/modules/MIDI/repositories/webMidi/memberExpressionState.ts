/** Latest expression on each MPE member channel, including messages before note-on. */
type MemberExpression = {
    pressure?: number;
    slide?: number;
    pitchBend?: number;
};

export const memberExpressionState = new Map<number, MemberExpression>();

export function setMemberExpression(channel: number, change: MemberExpression): void {
    memberExpressionState.set(channel, { ...memberExpressionState.get(channel), ...change });
}
