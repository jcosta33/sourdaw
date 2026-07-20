pub const LOWER_ZONE_FIRST_MEMBER_CHANNEL: u8 = 2;
pub const LOWER_ZONE_LAST_MEMBER_CHANNEL: u8 = 16;
pub const LOWER_ZONE_MEMBER_CHANNEL_COUNT: usize = 15;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MpeAllocationError {
    Exhausted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NoteRelease {
    Released,
    Sustained,
    NotLive,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct MpeAllocatorDiagnostics {
    pub channel_reuse_stalls: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ChannelState {
    Idle,
    KeyDown(u8),
    Sustained(u8),
}

const INITIAL_LRU_ORDER: [u8; LOWER_ZONE_MEMBER_CHANNEL_COUNT] =
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

pub struct MpeAllocator {
    channels: [ChannelState; LOWER_ZONE_MEMBER_CHANNEL_COUNT],
    lru_order: [u8; LOWER_ZONE_MEMBER_CHANNEL_COUNT],
    diagnostics: MpeAllocatorDiagnostics,
    sustain_active: bool,
}

impl MpeAllocator {
    pub const fn new() -> Self {
        Self {
            channels: [ChannelState::Idle; LOWER_ZONE_MEMBER_CHANNEL_COUNT],
            lru_order: INITIAL_LRU_ORDER,
            diagnostics: MpeAllocatorDiagnostics {
                channel_reuse_stalls: 0,
            },
            sustain_active: false,
        }
    }

    pub fn allocate_note(&mut self, note: u8) -> Result<u8, MpeAllocationError> {
        let mut available_lru_position = None;

        for lru_position in 0..LOWER_ZONE_MEMBER_CHANNEL_COUNT {
            let channel_index = self.lru_order[lru_position] as usize;
            if self.channels[channel_index] == ChannelState::Idle {
                available_lru_position = Some(lru_position);
                break;
            }
        }

        let Some(lru_position) = available_lru_position else {
            self.diagnostics.channel_reuse_stalls =
                self.diagnostics.channel_reuse_stalls.saturating_add(1);
            return Err(MpeAllocationError::Exhausted);
        };

        let channel_index = self.lru_order[lru_position] as usize;
        self.channels[channel_index] = ChannelState::KeyDown(note);
        self.mark_as_most_recently_used(lru_position);

        Ok(Self::channel_for_index(channel_index))
    }

    pub fn release_note(&mut self, channel: u8) -> NoteRelease {
        let Some(channel_index) = Self::index_for_channel(channel) else {
            return NoteRelease::NotLive;
        };

        match self.channels[channel_index] {
            ChannelState::Idle => NoteRelease::NotLive,
            ChannelState::KeyDown(note) if self.sustain_active => {
                self.channels[channel_index] = ChannelState::Sustained(note);
                NoteRelease::Sustained
            }
            ChannelState::KeyDown(_) => {
                self.channels[channel_index] = ChannelState::Idle;
                NoteRelease::Released
            }
            ChannelState::Sustained(_) => NoteRelease::Sustained,
        }
    }

    pub fn set_sustain(&mut self, sustain_active: bool) {
        self.sustain_active = sustain_active;

        if sustain_active {
            return;
        }

        for channel_index in 0..LOWER_ZONE_MEMBER_CHANNEL_COUNT {
            if matches!(self.channels[channel_index], ChannelState::Sustained(_)) {
                self.channels[channel_index] = ChannelState::Idle;
            }
        }
    }

    pub fn all_notes_off(&mut self) {
        self.sustain_active = false;

        for channel_index in 0..LOWER_ZONE_MEMBER_CHANNEL_COUNT {
            self.channels[channel_index] = ChannelState::Idle;
        }
    }

    pub fn sustain_active(&self) -> bool {
        self.sustain_active
    }

    pub fn active_note(&self, channel: u8) -> Option<u8> {
        let channel_index = Self::index_for_channel(channel)?;

        match self.channels[channel_index] {
            ChannelState::Idle => None,
            ChannelState::KeyDown(note) | ChannelState::Sustained(note) => Some(note),
        }
    }

    pub fn is_live(&self, channel: u8) -> bool {
        self.active_note(channel).is_some()
    }

    pub fn live_channel_count(&self) -> usize {
        let mut live_channels = 0;

        for channel_index in 0..LOWER_ZONE_MEMBER_CHANNEL_COUNT {
            if self.channels[channel_index] != ChannelState::Idle {
                live_channels += 1;
            }
        }

        live_channels
    }

    pub fn diagnostics(&self) -> MpeAllocatorDiagnostics {
        self.diagnostics
    }

    fn index_for_channel(channel: u8) -> Option<usize> {
        if !(LOWER_ZONE_FIRST_MEMBER_CHANNEL..=LOWER_ZONE_LAST_MEMBER_CHANNEL).contains(&channel) {
            return None;
        }

        Some((channel - LOWER_ZONE_FIRST_MEMBER_CHANNEL) as usize)
    }

    fn channel_for_index(channel_index: usize) -> u8 {
        LOWER_ZONE_FIRST_MEMBER_CHANNEL + channel_index as u8
    }

    fn mark_as_most_recently_used(&mut self, lru_position: usize) {
        let channel_index = self.lru_order[lru_position];

        for position in lru_position..LOWER_ZONE_MEMBER_CHANNEL_COUNT - 1 {
            self.lru_order[position] = self.lru_order[position + 1];
        }

        self.lru_order[LOWER_ZONE_MEMBER_CHANNEL_COUNT - 1] = channel_index;
    }
}

impl Default for MpeAllocator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPECTED_MEMBER_CHANNELS: [u8; LOWER_ZONE_MEMBER_CHANNEL_COUNT] =
        [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

    fn fill_allocator(allocator: &mut MpeAllocator) -> [u8; LOWER_ZONE_MEMBER_CHANNEL_COUNT] {
        let mut channels = [0; LOWER_ZONE_MEMBER_CHANNEL_COUNT];

        for (index, channel) in channels.iter_mut().enumerate() {
            *channel = allocator
                .allocate_note(48 + index as u8)
                .expect("member channel should be available");
        }

        channels
    }

    #[test]
    fn normal_allocation_uses_lower_zone_member_channels_two_through_sixteen() {
        let mut allocator = MpeAllocator::new();
        let channels = fill_allocator(&mut allocator);

        assert_eq!(channels, EXPECTED_MEMBER_CHANNELS);
        assert_eq!(
            allocator.live_channel_count(),
            LOWER_ZONE_MEMBER_CHANNEL_COUNT
        );
        assert_eq!(LOWER_ZONE_FIRST_MEMBER_CHANNEL, 2);
        assert_eq!(LOWER_ZONE_LAST_MEMBER_CHANNEL, 16);

        for (index, channel) in channels.into_iter().enumerate() {
            assert_eq!(allocator.active_note(channel), Some(48 + index as u8));
        }
    }

    #[test]
    fn exhaustion_reports_a_stall_without_reusing_any_live_channel() {
        let mut allocator = MpeAllocator::new();
        let channels = fill_allocator(&mut allocator);

        assert_eq!(
            allocator.allocate_note(100),
            Err(MpeAllocationError::Exhausted)
        );
        assert_eq!(allocator.diagnostics().channel_reuse_stalls, 1);

        for (index, channel) in channels.into_iter().enumerate() {
            assert_eq!(allocator.active_note(channel), Some(48 + index as u8));
        }
    }

    #[test]
    fn reuse_selects_the_least_recently_used_released_channel() {
        let mut allocator = MpeAllocator::new();
        let channels = fill_allocator(&mut allocator);

        assert_eq!(allocator.release_note(channels[1]), NoteRelease::Released);
        assert_eq!(allocator.release_note(channels[0]), NoteRelease::Released);

        assert_eq!(allocator.allocate_note(90), Ok(channels[0]));
        assert_eq!(allocator.allocate_note(91), Ok(channels[1]));
        assert_eq!(allocator.active_note(channels[2]), Some(50));
    }

    #[test]
    fn release_immediately_frees_a_channel_when_sustain_is_inactive() {
        let mut allocator = MpeAllocator::new();
        let channels = fill_allocator(&mut allocator);
        let released_channel = channels[6];

        assert_eq!(
            allocator.release_note(released_channel),
            NoteRelease::Released
        );
        assert!(!allocator.is_live(released_channel));
        assert_eq!(allocator.allocate_note(96), Ok(released_channel));
    }

    #[test]
    fn sustain_release_frees_only_notes_whose_keys_are_up() {
        let mut allocator = MpeAllocator::new();
        let channels = fill_allocator(&mut allocator);

        allocator.set_sustain(true);
        assert_eq!(allocator.release_note(channels[0]), NoteRelease::Sustained);
        assert!(allocator.is_live(channels[0]));
        assert_eq!(allocator.active_note(channels[0]), Some(48));
        assert_eq!(
            allocator.allocate_note(100),
            Err(MpeAllocationError::Exhausted)
        );

        allocator.set_sustain(false);
        assert!(!allocator.is_live(channels[0]));
        assert!(allocator.is_live(channels[1]));
        assert_eq!(allocator.allocate_note(100), Ok(channels[0]));
    }

    #[test]
    fn all_notes_off_clears_pressed_sustained_and_pedal_state() {
        let mut allocator = MpeAllocator::new();
        let channels = fill_allocator(&mut allocator);

        allocator.set_sustain(true);
        assert_eq!(allocator.release_note(channels[0]), NoteRelease::Sustained);
        allocator.all_notes_off();

        assert!(!allocator.sustain_active());
        assert_eq!(allocator.live_channel_count(), 0);
        for channel in channels {
            assert_eq!(allocator.active_note(channel), None);
        }
        assert_eq!(allocator.allocate_note(72), Ok(channels[0]));
    }

    #[test]
    fn ten_thousand_event_stress_never_reuses_live_channels_and_stalls_once() {
        let mut allocator = MpeAllocator::new();
        let mut channels = fill_allocator(&mut allocator);

        assert_eq!(
            allocator.allocate_note(127),
            Err(MpeAllocationError::Exhausted)
        );

        for event_index in 16..10_000 {
            let slot_index = event_index % LOWER_ZONE_MEMBER_CHANNEL_COUNT;
            let released_channel = channels[slot_index];

            assert_eq!(
                allocator.release_note(released_channel),
                NoteRelease::Released
            );
            let allocated_channel = allocator
                .allocate_note((event_index % 128) as u8)
                .expect("the released channel should be reusable");
            assert_eq!(allocated_channel, released_channel);
            channels[slot_index] = allocated_channel;
            assert_eq!(
                allocator.live_channel_count(),
                LOWER_ZONE_MEMBER_CHANNEL_COUNT
            );
        }

        assert!(allocator.diagnostics().channel_reuse_stalls <= 1);
    }
}
