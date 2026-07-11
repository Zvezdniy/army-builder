use std::collections::HashSet;
use crate::error::Diagnostic;
use super::model::RawCatalogue;

/// Merge a supporting file (a `.gst` game system, or later a sibling library)
/// into the primary catalogue in place, so the single-file resolve/to_ir
/// pipeline sees one combined symbol pool and one set of maps. Called once per
/// supporting file, before resolve.
///
/// - Validates the supporting file is the primary's declared game system
///   (`gameSystemId`); emits a diagnostic on mismatch or when unverifiable, but
///   still merges (the caller chose these files explicitly).
/// - Extends shared entries/groups, de-duplicating TOP-LEVEL ids across files
///   (primary's definition wins; the dropped duplicate is diagnosed) so a
///   cross-file id clash never crashes SymbolTable::build. Deeper (nested)
///   cross-file id clashes remain a hard error from build — genuinely malformed.
/// - Unions cost-type and category maps (primary wins on the — unexpected — key
///   clash; real BSData ids are disjoint GUIDs).
/// - Appends the supporting file's forceEntries (the game system's force-org).
/// - Leaves the primary's entries / entry_links / catalogue_links untouched: the
///   roots we emit are the faction's, not the system's.
pub fn merge_supporting(
    primary: &mut RawCatalogue,
    supporting: RawCatalogue,
    diags: &mut Vec<Diagnostic>,
) {
    // gameSystemId binding check.
    match primary.game_system_id.as_deref() {
        Some(gs) if !gs.is_empty() => {
            if gs != supporting.id {
                diags.push(Diagnostic {
                    code: "gameSystem.mismatch".to_string(),
                    message: format!(
                        "supporting file {} is not the primary's game system {} (merged anyway)",
                        supporting.id, gs
                    ),
                });
            }
        }
        _ => diags.push(Diagnostic {
            code: "gameSystem.unverified".to_string(),
            message: format!(
                "primary has no gameSystemId; cannot verify supporting file {} (merged anyway)",
                supporting.id
            ),
        }),
    }

    // Collect existing top-level shared ids to de-dup across files.
    let mut seen: HashSet<String> = HashSet::new();
    for e in &primary.shared_entries {
        seen.insert(e.id.clone());
    }
    for g in &primary.shared_groups {
        seen.insert(g.id.clone());
    }

    for e in supporting.shared_entries {
        if seen.insert(e.id.clone()) {
            primary.shared_entries.push(e);
        } else {
            diags.push(duplicate_cross_file_diag(&e.id));
        }
    }
    for g in supporting.shared_groups {
        if seen.insert(g.id.clone()) {
            primary.shared_groups.push(g);
        } else {
            diags.push(duplicate_cross_file_diag(&g.id));
        }
    }

    // Union maps: primary wins on key clash (insert only if absent).
    for (k, v) in supporting.cost_types {
        primary.cost_types.entry(k).or_insert(v);
    }
    for (k, v) in supporting.categories {
        primary.categories.entry(k).or_insert(v);
    }

    // Append the supporting file's force-org.
    primary.force_entries.extend(supporting.force_entries);

    // Diagnose dropped top-level roots that we don't surface.
    if !supporting.entries.is_empty() {
        diags.push(Diagnostic {
            code: "gameSystem.entries_dropped".to_string(),
            message: format!(
                "supporting file {}: {} top-level entries dropped (only shared entries are merged)",
                supporting.id,
                supporting.entries.len()
            ),
        });
    }
    if !supporting.entry_links.is_empty() {
        diags.push(Diagnostic {
            code: "gameSystem.entry_links_dropped".to_string(),
            message: format!(
                "supporting file {}: {} top-level entryLinks dropped (system-level roots not surfaced)",
                supporting.id,
                supporting.entry_links.len()
            ),
        });
    }
    if !supporting.catalogue_links.is_empty() {
        diags.push(Diagnostic {
            code: "gameSystem.catalogue_links_dropped".to_string(),
            message: format!(
                "supporting file {}: {} catalogueLinks dropped (sibling libraries are out of scope)",
                supporting.id,
                supporting.catalogue_links.len()
            ),
        });
    }
}

fn duplicate_cross_file_diag(id: &str) -> Diagnostic {
    Diagnostic {
        code: "symbol.duplicate_cross_file".to_string(),
        message: format!(
            "shared id {} defined in multiple files; keeping the primary's (dropped the duplicate)",
            id
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raw::{RawEntry, RawEntryLink, RawForce};
    use std::collections::HashMap;

    fn shared_entry(id: &str) -> RawEntry {
        RawEntry { id: id.to_string(), entry_type: "upgrade".into(), ..Default::default() }
    }

    #[test]
    fn unions_maps_and_appends_forces() {
        let mut primary = RawCatalogue {
            id: "cat".into(),
            game_system_id: Some("sys".into()),
            cost_types: HashMap::from([("pts".to_string(), "Points".to_string())]),
            categories: HashMap::from([("hq".to_string(), "HQ".to_string())]),
            ..Default::default()
        };
        let supporting = RawCatalogue {
            id: "sys".into(),
            cost_types: HashMap::from([("pl".to_string(), "Power".to_string())]),
            categories: HashMap::from([("tr".to_string(), "Troops".to_string())]),
            force_entries: vec![RawForce { id: "f1".into(), ..Default::default() }],
            shared_entries: vec![shared_entry("s.weapon")],
            ..Default::default()
        };
        let mut diags = Vec::new();
        merge_supporting(&mut primary, supporting, &mut diags);
        assert_eq!(primary.cost_types.len(), 2);
        assert_eq!(primary.categories.len(), 2);
        assert_eq!(primary.force_entries.len(), 1);
        assert!(primary.shared_entries.iter().any(|e| e.id == "s.weapon"));
        assert!(diags.is_empty(), "clean merge has no diagnostics: {:?}", diags);
    }

    #[test]
    fn primary_wins_on_map_key_clash() {
        let mut primary = RawCatalogue {
            id: "cat".into(), game_system_id: Some("sys".into()),
            cost_types: HashMap::from([("pts".to_string(), "PrimaryName".to_string())]),
            ..Default::default()
        };
        let supporting = RawCatalogue {
            id: "sys".into(),
            cost_types: HashMap::from([("pts".to_string(), "SupportingName".to_string())]),
            ..Default::default()
        };
        merge_supporting(&mut primary, supporting, &mut Vec::new());
        assert_eq!(primary.cost_types.get("pts").unwrap(), "PrimaryName");
    }

    #[test]
    fn cross_file_duplicate_shared_id_is_diagnosed_and_dropped() {
        let mut primary = RawCatalogue {
            id: "cat".into(), game_system_id: Some("sys".into()),
            shared_entries: vec![shared_entry("dup")],
            ..Default::default()
        };
        let supporting = RawCatalogue {
            id: "sys".into(),
            shared_entries: vec![shared_entry("dup"), shared_entry("fresh")],
            ..Default::default()
        };
        let mut diags = Vec::new();
        merge_supporting(&mut primary, supporting, &mut diags);
        assert_eq!(primary.shared_entries.iter().filter(|e| e.id == "dup").count(), 1);
        assert!(primary.shared_entries.iter().any(|e| e.id == "fresh"));
        assert!(diags.iter().any(|d| d.code == "symbol.duplicate_cross_file" && d.message.contains("dup")));
    }

    #[test]
    fn mismatched_game_system_is_diagnosed_but_merged() {
        let mut primary = RawCatalogue {
            id: "cat".into(), game_system_id: Some("sys.expected".into()),
            ..Default::default()
        };
        let supporting = RawCatalogue {
            id: "sys.other".into(),
            shared_entries: vec![shared_entry("s")],
            ..Default::default()
        };
        let mut diags = Vec::new();
        merge_supporting(&mut primary, supporting, &mut diags);
        assert!(diags.iter().any(|d| d.code == "gameSystem.mismatch"));
        assert!(primary.shared_entries.iter().any(|e| e.id == "s"), "still merged");
    }

    #[test]
    fn missing_game_system_id_is_unverified() {
        let mut primary = RawCatalogue { id: "cat".into(), game_system_id: None, ..Default::default() };
        let supporting = RawCatalogue { id: "sys".into(), ..Default::default() };
        let mut diags = Vec::new();
        merge_supporting(&mut primary, supporting, &mut diags);
        assert!(diags.iter().any(|d| d.code == "gameSystem.unverified"));
    }

    #[test]
    fn supporting_top_level_roots_are_diagnosed_when_dropped() {
        let mut primary = RawCatalogue {
            id: "cat".into(),
            game_system_id: Some("sys".into()),
            ..Default::default()
        };
        let supporting = RawCatalogue {
            id: "sys".into(),
            entry_links: vec![RawEntryLink {
                target_id: "root1".into(),
                link_type: "profile".into(),
            }],
            ..Default::default()
        };
        let mut diags = Vec::new();
        merge_supporting(&mut primary, supporting, &mut diags);
        assert!(
            diags.iter().any(|d| d.code == "gameSystem.entry_links_dropped"
                && d.message.contains("1 top-level entryLinks dropped")),
            "expected diagnostic for dropped entry_links, got: {:?}",
            diags
        );
    }
}
