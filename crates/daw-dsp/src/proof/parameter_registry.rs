//! Canonical Proof target identities. IDs are explicit and append-only; the
//! versioned JSON worklet projection is exhaustively welded by integration tests.
//! Project delivery targets are metadata, not audio parameters. Native graph
//! bypass and persisted A/B have separate admission dispositions below.

pub const VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParameterKind {
    Continuous,
    Toggle,
    Integer,
}

impl ParameterKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Continuous => "continuous",
            Self::Toggle => "toggle",
            Self::Integer => "integer",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParameterRoute {
    Chain,
    Eq,
    DynamicEq,
    MatchEq,
    Dynamics,
    Imager,
    Exciter,
    Limiter,
    Dither,
    Order,
}

impl ParameterRoute {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chain => "chain",
            Self::Eq => "eq",
            Self::DynamicEq => "dynamic-eq",
            Self::MatchEq => "match-eq",
            Self::Dynamics => "dynamics",
            Self::Imager => "imager",
            Self::Exciter => "exciter",
            Self::Limiter => "limiter",
            Self::Dither => "dither",
            Self::Order => "order",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Parameter {
    pub id: u16,
    pub name: &'static str,
    pub route: ParameterRoute,
    pub kind: ParameterKind,
    pub minimum: f32,
    pub maximum: f32,
    /// Bare DSP constructor target, deliberately distinct from DEFAULT_PATCH.
    pub default: f32,
    pub live_minimum: f32,
    pub live_maximum: f32,
    pub live: bool,
    pub persisted: bool,
    pub clamp: bool,
}

impl Parameter {
    pub fn normalize(&self, value: f32) -> Option<f32> {
        if !value.is_finite()
            || (self.kind != ParameterKind::Continuous && value.fract() != 0.0)
        {
            return None;
        }
        if self.clamp {
            return Some(value.clamp(self.minimum, self.maximum));
        }
        (value >= self.minimum && value <= self.maximum).then_some(value)
    }
}

macro_rules! parameter {
    ($id:literal,$name:literal,$route:ident,$kind:ident,$min:expr,$max:expr,$default:expr,$live_min:expr,$live_max:expr,$live:literal,$persisted:literal,$clamp:literal) => {
        Parameter { id:$id,name:$name,route:ParameterRoute::$route,kind:ParameterKind::$kind,minimum:$min,maximum:$max,default:$default,live_minimum:$live_min,live_maximum:$live_max,live:$live,persisted:$persisted,clamp:$clamp }
    };
}
pub const PARAMETERS: &[Parameter] = &[
    parameter!(0,"bypass",Chain,Toggle,0.0,1.0,0.0,0.0,1.0,true,false,false),
    parameter!(1,"ab_bypass",Chain,Toggle,0.0,1.0,0.0,0.0,1.0,true,false,false),
    parameter!(2,"input_gain",Chain,Continuous,-24.0,24.0,0.0,-24.0,24.0,true,true,true),
    parameter!(3,"output_gain",Chain,Continuous,-24.0,24.0,0.0,-24.0,24.0,true,true,true),
    parameter!(4,"eq_bypass",Eq,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(5,"dyn_bypass",Dynamics,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(6,"img_bypass",Imager,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(7,"img_auto_mono_bass",Imager,Toggle,0.0,1.0,1.0,0.0,1.0,true,true,false),
    parameter!(8,"img_mono_bass_freq",Imager,Continuous,40.0,200.0,80.0,40.0,200.0,true,true,true),
    parameter!(9,"exc_bypass",Exciter,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(10,"lim_bypass",Limiter,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(11,"lim_ceiling",Limiter,Continuous,-12.0,0.0,-1.0,-12.0,0.0,true,true,true),
    parameter!(12,"lim_release",Limiter,Continuous,10.0,500.0,100.0,10.0,500.0,true,true,true),
    parameter!(13,"lim_lookahead",Limiter,Continuous,0.5,10.0,5.0,0.5,10.0,true,true,true),
    parameter!(14,"dither_mode",Dither,Integer,0.0,2.0,0.0,0.0,2.0,true,true,false),
    parameter!(15,"dither_bits",Dither,Integer,8.0,32.0,16.0,16.0,24.0,true,true,true),
    parameter!(16,"eq_linear_phase",Chain,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(17,"eq_band0_freq",Eq,Continuous,20.0,20000.0,30.0,20.0,20000.0,true,true,true),
    parameter!(18,"eq_band0_gain",Eq,Continuous,-18.0,18.0,0.0,-18.0,18.0,true,true,true),
    parameter!(19,"eq_band0_q",Eq,Continuous,0.1,10.0,1.0,0.1,10.0,true,true,true),
    parameter!(20,"eq_band0_type",Eq,Integer,0.0,4.0,3.0,0.0,4.0,true,true,false),
    parameter!(21,"eq_band0_channel",Eq,Integer,0.0,2.0,0.0,0.0,2.0,true,true,false),
    parameter!(22,"eq_band0_enabled",Eq,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(23,"eq_band1_freq",Eq,Continuous,20.0,20000.0,80.0,20.0,20000.0,true,true,true),
    parameter!(24,"eq_band1_gain",Eq,Continuous,-18.0,18.0,0.0,-18.0,18.0,true,true,true),
    parameter!(25,"eq_band1_q",Eq,Continuous,0.1,10.0,1.0,0.1,10.0,true,true,true),
    parameter!(26,"eq_band1_type",Eq,Integer,0.0,4.0,1.0,0.0,4.0,true,true,false),
    parameter!(27,"eq_band1_channel",Eq,Integer,0.0,2.0,0.0,0.0,2.0,true,true,false),
    parameter!(28,"eq_band1_enabled",Eq,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(29,"eq_band2_freq",Eq,Continuous,20.0,20000.0,250.0,20.0,20000.0,true,true,true),
    parameter!(30,"eq_band2_gain",Eq,Continuous,-18.0,18.0,0.0,-18.0,18.0,true,true,true),
    parameter!(31,"eq_band2_q",Eq,Continuous,0.1,10.0,1.0,0.1,10.0,true,true,true),
    parameter!(32,"eq_band2_type",Eq,Integer,0.0,4.0,0.0,0.0,4.0,true,true,false),
    parameter!(33,"eq_band2_channel",Eq,Integer,0.0,2.0,0.0,0.0,2.0,true,true,false),
    parameter!(34,"eq_band2_enabled",Eq,Toggle,0.0,1.0,1.0,0.0,1.0,true,true,false),
    parameter!(35,"eq_band3_freq",Eq,Continuous,20.0,20000.0,800.0,20.0,20000.0,true,true,true),
    parameter!(36,"eq_band3_gain",Eq,Continuous,-18.0,18.0,0.0,-18.0,18.0,true,true,true),
    parameter!(37,"eq_band3_q",Eq,Continuous,0.1,10.0,1.0,0.1,10.0,true,true,true),
    parameter!(38,"eq_band3_type",Eq,Integer,0.0,4.0,0.0,0.0,4.0,true,true,false),
    parameter!(39,"eq_band3_channel",Eq,Integer,0.0,2.0,0.0,0.0,2.0,true,true,false),
    parameter!(40,"eq_band3_enabled",Eq,Toggle,0.0,1.0,1.0,0.0,1.0,true,true,false),
    parameter!(41,"eq_band4_freq",Eq,Continuous,20.0,20000.0,2500.0,20.0,20000.0,true,true,true),
    parameter!(42,"eq_band4_gain",Eq,Continuous,-18.0,18.0,0.0,-18.0,18.0,true,true,true),
    parameter!(43,"eq_band4_q",Eq,Continuous,0.1,10.0,1.0,0.1,10.0,true,true,true),
    parameter!(44,"eq_band4_type",Eq,Integer,0.0,4.0,0.0,0.0,4.0,true,true,false),
    parameter!(45,"eq_band4_channel",Eq,Integer,0.0,2.0,0.0,0.0,2.0,true,true,false),
    parameter!(46,"eq_band4_enabled",Eq,Toggle,0.0,1.0,1.0,0.0,1.0,true,true,false),
    parameter!(47,"eq_band5_freq",Eq,Continuous,20.0,20000.0,6000.0,20.0,20000.0,true,true,true),
    parameter!(48,"eq_band5_gain",Eq,Continuous,-18.0,18.0,0.0,-18.0,18.0,true,true,true),
    parameter!(49,"eq_band5_q",Eq,Continuous,0.1,10.0,1.0,0.1,10.0,true,true,true),
    parameter!(50,"eq_band5_type",Eq,Integer,0.0,4.0,0.0,0.0,4.0,true,true,false),
    parameter!(51,"eq_band5_channel",Eq,Integer,0.0,2.0,0.0,0.0,2.0,true,true,false),
    parameter!(52,"eq_band5_enabled",Eq,Toggle,0.0,1.0,1.0,0.0,1.0,true,true,false),
    parameter!(53,"eq_band6_freq",Eq,Continuous,20.0,20000.0,12000.0,20.0,20000.0,true,true,true),
    parameter!(54,"eq_band6_gain",Eq,Continuous,-18.0,18.0,0.0,-18.0,18.0,true,true,true),
    parameter!(55,"eq_band6_q",Eq,Continuous,0.1,10.0,1.0,0.1,10.0,true,true,true),
    parameter!(56,"eq_band6_type",Eq,Integer,0.0,4.0,2.0,0.0,4.0,true,true,false),
    parameter!(57,"eq_band6_channel",Eq,Integer,0.0,2.0,0.0,0.0,2.0,true,true,false),
    parameter!(58,"eq_band6_enabled",Eq,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(59,"eq_band7_freq",Eq,Continuous,20.0,20000.0,18000.0,20.0,20000.0,true,true,true),
    parameter!(60,"eq_band7_gain",Eq,Continuous,-18.0,18.0,0.0,-18.0,18.0,true,true,true),
    parameter!(61,"eq_band7_q",Eq,Continuous,0.1,10.0,1.0,0.1,10.0,true,true,true),
    parameter!(62,"eq_band7_type",Eq,Integer,0.0,4.0,4.0,0.0,4.0,true,true,false),
    parameter!(63,"eq_band7_channel",Eq,Integer,0.0,2.0,0.0,0.0,2.0,true,true,false),
    parameter!(64,"eq_band7_enabled",Eq,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(65,"dyn_xover0",Dynamics,Continuous,20.0,20000.0,120.0,20.0,20000.0,true,true,true),
    parameter!(66,"dyn_xover1",Dynamics,Continuous,20.0,20000.0,1000.0,20.0,20000.0,true,true,true),
    parameter!(67,"dyn_xover2",Dynamics,Continuous,20.0,20000.0,8000.0,20.0,20000.0,true,true,true),
    parameter!(68,"dyn_band0_threshold",Dynamics,Continuous,-60.0,0.0,-20.0,-60.0,0.0,true,true,true),
    parameter!(69,"dyn_band0_ratio",Dynamics,Continuous,1.0,20.0,2.0,1.0,20.0,true,true,true),
    parameter!(70,"dyn_band0_attack",Dynamics,Continuous,1.0,200.0,10.0,1.0,200.0,true,true,true),
    parameter!(71,"dyn_band0_release",Dynamics,Continuous,10.0,2000.0,100.0,10.0,2000.0,true,true,true),
    parameter!(72,"dyn_band0_knee",Dynamics,Continuous,0.0,12.0,6.0,0.0,12.0,true,true,true),
    parameter!(73,"dyn_band0_makeup",Dynamics,Continuous,-12.0,24.0,0.0,-12.0,24.0,true,true,true),
    parameter!(74,"dyn_band0_auto_makeup",Dynamics,Toggle,0.0,1.0,1.0,0.0,1.0,true,true,false),
    parameter!(75,"dyn_band0_bypass",Dynamics,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(76,"img_width0",Imager,Continuous,0.0,2.0,0.0,0.0,2.0,true,true,true),
    parameter!(77,"exc_band0_type",Exciter,Integer,0.0,3.0,0.0,0.0,3.0,true,true,false),
    parameter!(78,"exc_band0_drive",Exciter,Continuous,0.0,1.0,0.3,0.0,1.0,true,true,true),
    parameter!(79,"exc_band0_blend",Exciter,Continuous,0.0,1.0,0.5,0.0,1.0,true,true,true),
    parameter!(80,"exc_band0_enabled",Exciter,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(81,"dyn_band1_threshold",Dynamics,Continuous,-60.0,0.0,-20.0,-60.0,0.0,true,true,true),
    parameter!(82,"dyn_band1_ratio",Dynamics,Continuous,1.0,20.0,2.0,1.0,20.0,true,true,true),
    parameter!(83,"dyn_band1_attack",Dynamics,Continuous,1.0,200.0,10.0,1.0,200.0,true,true,true),
    parameter!(84,"dyn_band1_release",Dynamics,Continuous,10.0,2000.0,100.0,10.0,2000.0,true,true,true),
    parameter!(85,"dyn_band1_knee",Dynamics,Continuous,0.0,12.0,6.0,0.0,12.0,true,true,true),
    parameter!(86,"dyn_band1_makeup",Dynamics,Continuous,-12.0,24.0,0.0,-12.0,24.0,true,true,true),
    parameter!(87,"dyn_band1_auto_makeup",Dynamics,Toggle,0.0,1.0,1.0,0.0,1.0,true,true,false),
    parameter!(88,"dyn_band1_bypass",Dynamics,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(89,"img_width1",Imager,Continuous,0.0,2.0,0.8,0.0,2.0,true,true,true),
    parameter!(90,"exc_band1_type",Exciter,Integer,0.0,3.0,0.0,0.0,3.0,true,true,false),
    parameter!(91,"exc_band1_drive",Exciter,Continuous,0.0,1.0,0.3,0.0,1.0,true,true,true),
    parameter!(92,"exc_band1_blend",Exciter,Continuous,0.0,1.0,0.5,0.0,1.0,true,true,true),
    parameter!(93,"exc_band1_enabled",Exciter,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(94,"dyn_band2_threshold",Dynamics,Continuous,-60.0,0.0,-20.0,-60.0,0.0,true,true,true),
    parameter!(95,"dyn_band2_ratio",Dynamics,Continuous,1.0,20.0,2.0,1.0,20.0,true,true,true),
    parameter!(96,"dyn_band2_attack",Dynamics,Continuous,1.0,200.0,10.0,1.0,200.0,true,true,true),
    parameter!(97,"dyn_band2_release",Dynamics,Continuous,10.0,2000.0,100.0,10.0,2000.0,true,true,true),
    parameter!(98,"dyn_band2_knee",Dynamics,Continuous,0.0,12.0,6.0,0.0,12.0,true,true,true),
    parameter!(99,"dyn_band2_makeup",Dynamics,Continuous,-12.0,24.0,0.0,-12.0,24.0,true,true,true),
    parameter!(100,"dyn_band2_auto_makeup",Dynamics,Toggle,0.0,1.0,1.0,0.0,1.0,true,true,false),
    parameter!(101,"dyn_band2_bypass",Dynamics,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(102,"img_width2",Imager,Continuous,0.0,2.0,1.0,0.0,2.0,true,true,true),
    parameter!(103,"exc_band2_type",Exciter,Integer,0.0,3.0,0.0,0.0,3.0,true,true,false),
    parameter!(104,"exc_band2_drive",Exciter,Continuous,0.0,1.0,0.3,0.0,1.0,true,true,true),
    parameter!(105,"exc_band2_blend",Exciter,Continuous,0.0,1.0,0.5,0.0,1.0,true,true,true),
    parameter!(106,"exc_band2_enabled",Exciter,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(107,"dyn_band3_threshold",Dynamics,Continuous,-60.0,0.0,-20.0,-60.0,0.0,true,true,true),
    parameter!(108,"dyn_band3_ratio",Dynamics,Continuous,1.0,20.0,2.0,1.0,20.0,true,true,true),
    parameter!(109,"dyn_band3_attack",Dynamics,Continuous,1.0,200.0,10.0,1.0,200.0,true,true,true),
    parameter!(110,"dyn_band3_release",Dynamics,Continuous,10.0,2000.0,100.0,10.0,2000.0,true,true,true),
    parameter!(111,"dyn_band3_knee",Dynamics,Continuous,0.0,12.0,6.0,0.0,12.0,true,true,true),
    parameter!(112,"dyn_band3_makeup",Dynamics,Continuous,-12.0,24.0,0.0,-12.0,24.0,true,true,true),
    parameter!(113,"dyn_band3_auto_makeup",Dynamics,Toggle,0.0,1.0,1.0,0.0,1.0,true,true,false),
    parameter!(114,"dyn_band3_bypass",Dynamics,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(115,"img_width3",Imager,Continuous,0.0,2.0,1.3,0.0,2.0,true,true,true),
    parameter!(116,"exc_band3_type",Exciter,Integer,0.0,3.0,0.0,0.0,3.0,true,true,false),
    parameter!(117,"exc_band3_drive",Exciter,Continuous,0.0,1.0,0.3,0.0,1.0,true,true,true),
    parameter!(118,"exc_band3_blend",Exciter,Continuous,0.0,1.0,0.5,0.0,1.0,true,true,true),
    parameter!(119,"exc_band3_enabled",Exciter,Toggle,0.0,1.0,0.0,0.0,1.0,true,true,false),
    parameter!(120,"eq_output_gain",Eq,Continuous,-24.0,24.0,0.0,-24.0,24.0,false,true,true),
    parameter!(121,"dyneq_bypass",DynamicEq,Toggle,0.0,1.0,0.0,0.0,1.0,false,true,false),
    parameter!(122,"dyneq_band0_freq",DynamicEq,Continuous,20.0,20000.0,200.0,20.0,20000.0,false,true,true),
    parameter!(123,"dyneq_band0_q",DynamicEq,Continuous,0.1,10.0,1.0,0.1,10.0,false,true,true),
    parameter!(124,"dyneq_band0_threshold",DynamicEq,Continuous,-60.0,0.0,-20.0,-60.0,0.0,false,true,true),
    parameter!(125,"dyneq_band0_ratio",DynamicEq,Continuous,1.0,20.0,2.0,1.0,20.0,false,true,true),
    parameter!(126,"dyneq_band0_attack",DynamicEq,Continuous,1.0,200.0,10.0,1.0,200.0,false,true,true),
    parameter!(127,"dyneq_band0_release",DynamicEq,Continuous,10.0,2000.0,100.0,10.0,2000.0,false,true,true),
    parameter!(128,"dyneq_band0_range",DynamicEq,Continuous,0.0,24.0,12.0,0.0,24.0,false,true,true),
    parameter!(129,"dyneq_band0_mode",DynamicEq,Toggle,0.0,1.0,0.0,0.0,1.0,false,true,false),
    parameter!(130,"dyneq_band0_enabled",DynamicEq,Toggle,0.0,1.0,0.0,0.0,1.0,false,true,false),
    parameter!(131,"dyneq_band1_freq",DynamicEq,Continuous,20.0,20000.0,1000.0,20.0,20000.0,false,true,true),
    parameter!(132,"dyneq_band1_q",DynamicEq,Continuous,0.1,10.0,1.0,0.1,10.0,false,true,true),
    parameter!(133,"dyneq_band1_threshold",DynamicEq,Continuous,-60.0,0.0,-20.0,-60.0,0.0,false,true,true),
    parameter!(134,"dyneq_band1_ratio",DynamicEq,Continuous,1.0,20.0,2.0,1.0,20.0,false,true,true),
    parameter!(135,"dyneq_band1_attack",DynamicEq,Continuous,1.0,200.0,10.0,1.0,200.0,false,true,true),
    parameter!(136,"dyneq_band1_release",DynamicEq,Continuous,10.0,2000.0,100.0,10.0,2000.0,false,true,true),
    parameter!(137,"dyneq_band1_range",DynamicEq,Continuous,0.0,24.0,12.0,0.0,24.0,false,true,true),
    parameter!(138,"dyneq_band1_mode",DynamicEq,Toggle,0.0,1.0,0.0,0.0,1.0,false,true,false),
    parameter!(139,"dyneq_band1_enabled",DynamicEq,Toggle,0.0,1.0,0.0,0.0,1.0,false,true,false),
    parameter!(140,"dyneq_band2_freq",DynamicEq,Continuous,20.0,20000.0,3000.0,20.0,20000.0,false,true,true),
    parameter!(141,"dyneq_band2_q",DynamicEq,Continuous,0.1,10.0,1.0,0.1,10.0,false,true,true),
    parameter!(142,"dyneq_band2_threshold",DynamicEq,Continuous,-60.0,0.0,-20.0,-60.0,0.0,false,true,true),
    parameter!(143,"dyneq_band2_ratio",DynamicEq,Continuous,1.0,20.0,2.0,1.0,20.0,false,true,true),
    parameter!(144,"dyneq_band2_attack",DynamicEq,Continuous,1.0,200.0,10.0,1.0,200.0,false,true,true),
    parameter!(145,"dyneq_band2_release",DynamicEq,Continuous,10.0,2000.0,100.0,10.0,2000.0,false,true,true),
    parameter!(146,"dyneq_band2_range",DynamicEq,Continuous,0.0,24.0,12.0,0.0,24.0,false,true,true),
    parameter!(147,"dyneq_band2_mode",DynamicEq,Toggle,0.0,1.0,0.0,0.0,1.0,false,true,false),
    parameter!(148,"dyneq_band2_enabled",DynamicEq,Toggle,0.0,1.0,0.0,0.0,1.0,false,true,false),
    parameter!(149,"dyneq_band3_freq",DynamicEq,Continuous,20.0,20000.0,8000.0,20.0,20000.0,false,true,true),
    parameter!(150,"dyneq_band3_q",DynamicEq,Continuous,0.1,10.0,1.0,0.1,10.0,false,true,true),
    parameter!(151,"dyneq_band3_threshold",DynamicEq,Continuous,-60.0,0.0,-20.0,-60.0,0.0,false,true,true),
    parameter!(152,"dyneq_band3_ratio",DynamicEq,Continuous,1.0,20.0,2.0,1.0,20.0,false,true,true),
    parameter!(153,"dyneq_band3_attack",DynamicEq,Continuous,1.0,200.0,10.0,1.0,200.0,false,true,true),
    parameter!(154,"dyneq_band3_release",DynamicEq,Continuous,10.0,2000.0,100.0,10.0,2000.0,false,true,true),
    parameter!(155,"dyneq_band3_range",DynamicEq,Continuous,0.0,24.0,12.0,0.0,24.0,false,true,true),
    parameter!(156,"dyneq_band3_mode",DynamicEq,Toggle,0.0,1.0,0.0,0.0,1.0,false,true,false),
    parameter!(157,"dyneq_band3_enabled",DynamicEq,Toggle,0.0,1.0,0.0,0.0,1.0,false,true,false),
    parameter!(158,"match_enabled",MatchEq,Toggle,0.0,1.0,0.0,0.0,1.0,false,true,false),
    parameter!(159,"match_amount",MatchEq,Continuous,0.0,1.5,0.5,0.0,1.5,false,true,true),
    parameter!(160,"match_smoothing",MatchEq,Continuous,0.08333333333333333,1.0,0.3333333333333333,0.08333333333333333,1.0,false,true,true),
    parameter!(161,"match_max_correction",MatchEq,Continuous,3.0,18.0,12.0,3.0,18.0,false,true,true),
    parameter!(162,"dyn_band0_solo",Dynamics,Toggle,0.0,1.0,0.0,0.0,1.0,false,true,false),
    parameter!(163,"dyn_band1_solo",Dynamics,Toggle,0.0,1.0,0.0,0.0,1.0,false,true,false),
    parameter!(164,"dyn_band2_solo",Dynamics,Toggle,0.0,1.0,0.0,0.0,1.0,false,true,false),
    parameter!(165,"dyn_band3_solo",Dynamics,Toggle,0.0,1.0,0.0,0.0,1.0,false,true,false),
    parameter!(166,"img_xover0",Imager,Continuous,20.0,20000.0,120.0,20.0,20000.0,false,true,true),
    parameter!(167,"img_xover1",Imager,Continuous,20.0,20000.0,1000.0,20.0,20000.0,false,true,true),
    parameter!(168,"img_xover2",Imager,Continuous,20.0,20000.0,8000.0,20.0,20000.0,false,true,true),
    parameter!(169,"chain_order_0",Order,Integer,0.0,4.0,0.0,0.0,4.0,false,true,false),
    parameter!(170,"chain_order_1",Order,Integer,0.0,4.0,1.0,0.0,4.0,false,true,false),
    parameter!(171,"chain_order_2",Order,Integer,0.0,4.0,2.0,0.0,4.0,false,true,false),
    parameter!(172,"chain_order_3",Order,Integer,0.0,4.0,3.0,0.0,4.0,false,true,false),
    parameter!(173,"chain_order_4",Order,Integer,0.0,4.0,4.0,0.0,4.0,false,true,false),
 ];

pub fn by_name(name: &str) -> Option<&'static Parameter> {
    PARAMETERS.iter().find(|parameter| parameter.name == name)
}
pub fn is_project_metadata(name: &str) -> bool {
    matches!(name, "target_mode" | "target_lufs")
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum NativeAdmission {
    Apply {
        parameter: &'static Parameter,
        value: f32,
    },
    ProjectMetadata,
    GraphOwned,
    RuntimeOnly,
}

/// A recognized record is not necessarily a DSP write. Keep those receipts
/// distinct so ignored project metadata can never be reported as applied audio.
pub fn admit_native(name: &str, value: f32, record: bool) -> Option<NativeAdmission> {
    if !value.is_finite() {
        return None;
    }
    if is_project_metadata(name) {
        return Some(NativeAdmission::ProjectMetadata);
    }
    if name == "bypass" {
        return Some(NativeAdmission::GraphOwned);
    }
    if record && name == "ab_bypass" {
        return Some(NativeAdmission::RuntimeOnly);
    }
    let parameter = by_name(name)?;
    Some(NativeAdmission::Apply {
        parameter,
        value: parameter.normalize(value)?,
    })
}
