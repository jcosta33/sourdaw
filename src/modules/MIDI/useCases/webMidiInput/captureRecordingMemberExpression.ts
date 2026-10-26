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
    return {
        ...member,
        ...(member.pitchBend === undefined
            ? {}
            : { pitchBendRangeSemitones: resolveBendRangeSemitones({ channel, mpeEnabled: true }) }),
    };
}
