/**
 * Yoseatsume Kakeibo - IndexedDB & Local Storage Facade (Schema v2)
 * Re-exports modular storage, backup merger, and repository components for 100% backward compatibility.
 */

export {
	DB_NAME,
	DB_VERSION,
	FORBIDDEN_PROTOTYPE_KEYS,
	DEFAULT_MASTER_CONFIG,
	DEFAULT_SUMMARY_SNAPSHOT
} from './db/defaults.js';

export {
	MemoryDatabase,
	StorageEngine
} from './db/storage_engine.js';

export {
	BackupMerger
} from './db/backup_merger.js';

export {
	YoseDB
} from './db/yose_db.js';
