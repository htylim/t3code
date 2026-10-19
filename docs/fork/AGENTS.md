Read `fork-guidelines.md` for guidelines specific to the fork and `fork-journal.md` for its downstream change history.

NEVER add fork-owned database migrations or change upstream migration history through app startup.
The migration sequence belongs exclusively to upstream. This includes data-only cleanup, not just
schema changes. Read [Database compatibility](fork-guidelines.md#database-compatibility) before
changing persistence or repairing stored data. Use separately executed maintenance for authorized
repairs. Do not reserve migration numbers, renumber upstream migrations, or bypass migration checks.
