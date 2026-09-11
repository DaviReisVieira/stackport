"""Hotspot ids a lesson step may point at.

A hotspot is an anchor rendered by the frontend next to a real control, which
the tutorial popover attaches to. The ids live here because trail content is
validated on the backend, and are mirrored in
ui/src/components/cloudscape/learn/hotspots.ts, where the anchors are actually
rendered. A frontend test reads this file and fails if the two lists drift, so
keep it plain data: one string literal per line, no logic.

Naming: {scope}-{noun}-{action}.
"""

KNOWN_HOTSPOT_IDS: frozenset[str] = frozenset(
    {
        # shell
        "learn-panel-anchor",
        "nav-resources",
        # s3
        "s3-buckets-create",
        "s3-buckets-table",
        "s3-upload",
        "s3-objects-table",
        # dynamodb
        "dynamodb-tables-create",
        "dynamodb-tables-table",
    }
)
