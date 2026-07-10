#![forbid(unsafe_code)]

pub mod error;
pub mod ir;
pub mod limits;
pub mod raw;
pub mod resolve;
pub mod xml;
pub mod zip;

pub use error::{Diagnostic, ParseError};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
