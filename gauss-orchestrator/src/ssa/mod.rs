//! SSA (Space Situational Awareness) fusion: measurement schema (201),
//! track association (202), uncertainty propagation (203).

pub mod association;
pub mod schema;

pub use association::{
    AssociationConfig, AssociationDiagnostic, AssociationEngine, MeasurementRef, TrackLifecycle,
    TrackState,
};
pub use schema::{
    Covariance6, Measurement, MeasurementBatch, OpticalMeasurement, RfMeasurement,
    SensorProvenance, ValidationError,
};
