export type DormantVcaTrackCandidate = {
    id: string;
    legacyGroupId: string;
    kind: 'vca';
    order: number;
    name: string;
    color: string;
    gain: number;
    muted: boolean;
    soloed: boolean;
    memberTrackIds: string[];
    clips: [];
    devices: [];
    sends: [];
    midiFx: [];
    inputId: null;
    outputId: null;
    meterEnabled: false;
};

export type VcaMigrationTrackCollection = {
    collectionId: string;
    selectedTrackId: string | null;
    trackIds: readonly string[];
    legacyVcaGroupIdByTrackId?: Readonly<Record<string, string | null>>;
};
export type MigrateLegacyVcaGroupsInput = {
    legacyGroups: unknown;
    trackCollections: readonly VcaMigrationTrackCollection[];
    existingCandidates?: readonly DormantVcaTrackCandidate[];
};

export type VcaGroupMigrationResult =
    | {
          status: 'ready';
          candidates: DormantVcaTrackCandidate[];
          collections: Array<{
              collectionId: string;
              selectedTrackId: string | null;
              trackIds: string[];
              assignments: Array<{ trackId: string; vcaTrackId: string }>;
              missingMembers: Array<{ legacyGroupId: string; trackId: string }>;
          }>;
      }
    | {
          status: 'invalid';
          errors: Array<{
              code:
                  | 'invalid-legacy-groups'
                  | 'invalid-group'
                  | 'invalid-gain'
                  | 'duplicate-group-id'
                  | 'invalid-candidate-order'
                  | 'duplicate-candidate-order'
                  | 'ambiguous-membership'
                  | 'unknown-membership-group';
              groupIndex?: number;
              collectionId?: string;
              field: string;
              value?: string;
              reference?: string;
          }>;
      };
