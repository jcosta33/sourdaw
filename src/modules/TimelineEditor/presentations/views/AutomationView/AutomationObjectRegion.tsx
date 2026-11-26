import { type ReactElement } from 'react';

import { type AutomationObject } from '../../../models/AutomationViewTypes';
import { LANE_HEIGHT } from '../../helpers/automationViewHelpers';

type AutomationObjectRegionProps = {
    object: AutomationObject;
    x: number;
    width: number;
    curveColor: string;
};

export const AutomationObjectRegion = ({ object, x, width, curveColor }: AutomationObjectRegionProps): ReactElement => (
    <g>
        <rect
            x={x}
            y={2}
            width={width}
            height={LANE_HEIGHT - 4}
            rx={4}
            fill={curveColor}
            fillOpacity={8 / 255}
            stroke={curveColor}
            strokeWidth={1}
            strokeOpacity={0.4}
            strokeDasharray={object.loopLength ? '6 3' : undefined}
        />
        <text x={x + 4} y={14} className="text-[7px] fill-muted-foreground/50 pointer-events-none font-mono">
            {object.poolId ? '🔗 ' : ''}
            {object.name}
        </text>
    </g>
);
