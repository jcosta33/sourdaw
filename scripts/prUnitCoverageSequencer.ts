import { resolve } from 'node:path';

import { unitCoverageShardCount } from './unitCoveragePaths.ts';

import type { BaseSequencer, TestSpecification, Vitest } from 'vitest/node';

export const PR_UNIT_COVERAGE_SHARD_ENV = 'SOURDAW_PR_UNIT_COVERAGE_SHARD';

const agentAcceptanceSpec = 'src/modules/AiRuntime/__tests__/agentSystemAcceptance.spec.ts';

export function createPrUnitCoverageSequencer(DefaultSequencer: typeof BaseSequencer): typeof BaseSequencer {
    return class PrUnitCoverageSequencer extends DefaultSequencer {
        private readonly shardIndex: number;

        constructor(context: Vitest) {
            super(context);
            const shard = context.config.shard;
            if (
                shard === undefined ||
                shard.count !== unitCoverageShardCount ||
                !Number.isInteger(shard.index) ||
                shard.index < 1 ||
                shard.index > unitCoverageShardCount
            ) {
                throw new Error('PR unit coverage requires one of four shards');
            }
            this.shardIndex = shard.index;
        }

        override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
            const defaultFiles = await super.shard(files);
            const agentPath = resolve(this.ctx.config.root, agentAcceptanceSpec);
            const matches = files.filter(({ moduleId }) => moduleId === agentPath);
            const [agent] = matches;
            if (agent === undefined || matches.length !== 1) {
                throw new Error(`PR unit coverage requires exactly one Agent acceptance spec, found ${matches.length}`);
            }

            if (this.shardIndex !== unitCoverageShardCount) {
                return defaultFiles.filter((spec) => spec !== agent);
            }
            return defaultFiles.includes(agent) ? defaultFiles : [...defaultFiles, agent];
        }
    };
}
