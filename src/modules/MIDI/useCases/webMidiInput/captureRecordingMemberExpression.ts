import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { memberExpressionState } from '../../repositories/webMidi/memberExpressionState';

import { resolveBendRangeSemitones } from './resolveBendRangeSemitones';

/** Member state at key strike, before a queued gesture can advance it. */
export function captureRecordingMemberExpression(channel: number):
    | {
          pressure?: number;
          slide?: number;
          pitchBend?: number;
          pitchBendRangeSemitones?: number;
      }
    | undefined {
    if (!getMpeEnabled() || channel < 1) {
        return undefined;
    }
    const member = memberExpressionState.get(channel);
    if (!member) {
        return undefined;
    }
    const captured: NonNullable<ReturnType<typeof captureRecordingMemberExpression>> = Object.assign({}, member);
    if (member.pitchBend !== undefined) {
        captured.pitchBendRangeSemitones = resolveBendRangeSemitones({ channel, mpeEnabled: true });
    }
    return captured;
}
