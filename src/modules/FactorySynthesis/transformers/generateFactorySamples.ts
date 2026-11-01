import { type RenderedFactorySample } from '../models/RenderedFactorySample';

import { generateBassPack } from './bass';
import { generate808Kit } from './drums808';
import { generate909Kit } from './drums909';
import { generateAcousticKit } from './drumsAcoustic';
import { generateLofiKit } from './drumsLofi';
import { generateImpactsPack } from './generateImpactsPack';
import { generateRisersPack } from './generateRisersPack';
import { generateKeysPack } from './keys';
import { generateElectronicPerc } from './percElectronic';
import { generateWorldPerc } from './percWorld';

export function generateFactorySamples(): RenderedFactorySample[] {
    return [
        ...generate909Kit(),
        ...generate808Kit(),
        ...generateAcousticKit(),
        ...generateLofiKit(),
        ...generateWorldPerc(),
        ...generateElectronicPerc(),
        ...generateBassPack(),
        ...generateKeysPack(),
        ...generateRisersPack(),
        ...generateImpactsPack(),
    ];
}
