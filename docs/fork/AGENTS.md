Read `fork-guidelines.md` for guidelines specific to the fork and `fork-journal.md` for its downstream change history.

For every requested stable fork release, follow [Making Fork releases](making-fork-releases.md).
Use the next numeric fork version, verify both distributed app bundles and the published downloads,
and include the documented Gatekeeper approval steps while Developer ID signing and notarization
remain unconfigured. A working bundled server alone does not prove the desktop app can be installed.

NEVER add fork-owned database migrations or change upstream migration history through app startup.
The migration sequence belongs exclusively to upstream. This includes data-only cleanup, not just
schema changes. Read [Database compatibility](fork-guidelines.md#database-compatibility) before
changing persistence or repairing stored data. Use separately executed maintenance for authorized
repairs. Do not reserve migration numbers, renumber upstream migrations, or bypass migration checks.
