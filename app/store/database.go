//go:build windows || darwin

package store

import (
	"bytes"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// currentSchemaVersion defines the current database schema version.
// Increment this when making schema changes that require migrations.
const currentSchemaVersion = 22

// database wraps the SQLite connection.
// SQLite handles its own locking for concurrent access:
// - Multiple readers can access the database simultaneously
// - Writers are serialized (only one writer at a time)
// - WAL mode allows readers to not block writers
// This means we don't need application-level locks for database operations.
type database struct {
	conn           *sql.DB
	cipher         *dataCipher
	encryptAppData bool
}

func newDatabase(dbPath string) (*database, error) {
	// Open database connection
	conn, err := sql.Open("sqlite3", dbPath+"?_foreign_keys=on&_journal_mode=WAL&_busy_timeout=5000&_txlock=immediate")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// Test the connection
	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	db := &database{
		conn: conn,
	}

	// Initialize schema
	if err := db.init(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("initialize database: %w", err)
	}
	if err := db.configureAppDataEncryption(); err != nil {
		conn.Close()
		return nil, err
	}

	return db, nil
}

func (db *database) Close() error {
	_, _ = db.conn.Exec("PRAGMA wal_checkpoint(TRUNCATE);")

	return db.conn.Close()
}

func (db *database) init() error {
	if _, err := db.conn.Exec("PRAGMA foreign_keys = ON"); err != nil {
		return fmt.Errorf("enable foreign keys: %w", err)
	}

	schema := fmt.Sprintf(`
	CREATE TABLE IF NOT EXISTS settings (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		device_id TEXT NOT NULL DEFAULT '',
		has_completed_first_run BOOLEAN NOT NULL DEFAULT 0,
		expose BOOLEAN NOT NULL DEFAULT 0,
		survey BOOLEAN NOT NULL DEFAULT TRUE,
		browser BOOLEAN NOT NULL DEFAULT 0,
		models TEXT NOT NULL DEFAULT '',
		agent BOOLEAN NOT NULL DEFAULT 0,
		tools BOOLEAN NOT NULL DEFAULT 0,
		working_dir TEXT NOT NULL DEFAULT '',
		context_length INTEGER NOT NULL DEFAULT 0,
		window_width INTEGER NOT NULL DEFAULT 0,
		window_height INTEGER NOT NULL DEFAULT 0,
		config_migrated BOOLEAN NOT NULL DEFAULT 0,
		airplane_mode BOOLEAN NOT NULL DEFAULT 0,
		turbo_enabled BOOLEAN NOT NULL DEFAULT 0,
		websearch_enabled BOOLEAN NOT NULL DEFAULT 0,
		selected_model TEXT NOT NULL DEFAULT '',
		sidebar_open BOOLEAN NOT NULL DEFAULT 0,
		last_home_view TEXT NOT NULL DEFAULT 'launch',
		think_enabled BOOLEAN NOT NULL DEFAULT 0,
		think_level TEXT NOT NULL DEFAULT '',
		cloud_setting_migrated BOOLEAN NOT NULL DEFAULT 0,
		remote TEXT NOT NULL DEFAULT '', -- deprecated
		auto_update_enabled BOOLEAN NOT NULL DEFAULT 1,
		schema_version INTEGER NOT NULL DEFAULT %d
	);

	-- Insert default settings row if it doesn't exist
	INSERT OR IGNORE INTO settings (id) VALUES (1);

	CREATE TABLE IF NOT EXISTS chats (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL DEFAULT '',
		created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		browser_state TEXT
	);

	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		chat_id TEXT NOT NULL,
		role TEXT NOT NULL,
		content TEXT NOT NULL DEFAULT '',
		thinking TEXT NOT NULL DEFAULT '',
		stream BOOLEAN NOT NULL DEFAULT 0,
		model_name TEXT,
		model_cloud BOOLEAN, -- deprecated
		model_ollama_host BOOLEAN, -- deprecated
		created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		thinking_time_start TIMESTAMP,
		thinking_time_end TIMESTAMP,
		tool_result TEXT,
		stats TEXT,
		context_notice TEXT,
		context_warnings TEXT,
		web_search_metadata TEXT,
		FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
	CREATE INDEX IF NOT EXISTS idx_messages_updated_at ON messages(updated_at);

	CREATE TABLE IF NOT EXISTS tool_calls (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		message_id INTEGER NOT NULL,
		type TEXT NOT NULL,
		function_name TEXT NOT NULL,
		function_arguments TEXT NOT NULL,
		function_result TEXT,
		FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_tool_calls_message_id ON tool_calls(message_id);

	CREATE TABLE IF NOT EXISTS message_embeddings (
		chat_id TEXT NOT NULL,
		model TEXT NOT NULL,
		content_hash TEXT NOT NULL,
		dimensions INTEGER NOT NULL,
		embedding BLOB NOT NULL,
		updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (chat_id, model, content_hash),
		FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_message_embeddings_chat_model ON message_embeddings(chat_id, model);
	CREATE INDEX IF NOT EXISTS idx_message_embeddings_model ON message_embeddings(model);

	CREATE TABLE IF NOT EXISTS attachments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		message_id INTEGER NOT NULL,
		filename TEXT NOT NULL,
		data BLOB NOT NULL,
		FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);

	CREATE TABLE IF NOT EXISTS users (
		name TEXT NOT NULL DEFAULT '',
		email TEXT NOT NULL DEFAULT '',
		plan TEXT NOT NULL DEFAULT '',
		cached_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS app_metadata (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL DEFAULT ''
	);
	`, currentSchemaVersion)

	_, err := db.conn.Exec(schema)
	if err != nil {
		return err
	}

	// Check and upgrade schema version if needed
	if err := db.migrate(); err != nil {
		return fmt.Errorf("migrate schema: %w", err)
	}

	// Clean up orphaned records created before foreign key constraints were properly enforced
	// TODO: Can eventually be removed - cleans up data from foreign key bug (ollama/ollama#11785, ollama/app#476)
	if err := db.cleanupOrphanedData(); err != nil {
		return fmt.Errorf("cleanup orphaned data: %w", err)
	}

	return nil
}

// migrate handles database schema migrations
func (db *database) migrate() error {
	// Get current schema version
	version, err := db.getSchemaVersion()
	if err != nil {
		return fmt.Errorf("get schema version after migration attempt: %w", err)
	}

	// Run migrations for each version
	for version < currentSchemaVersion {
		switch version {
		case 1:
			// Migrate from version 1 to 2: add context_length column
			if err := db.migrateV1ToV2(); err != nil {
				return fmt.Errorf("migrate v1 to v2: %w", err)
			}
			version = 2
		case 2:
			// Migrate from version 2 to 3: create attachments table
			if err := db.migrateV2ToV3(); err != nil {
				return fmt.Errorf("migrate v2 to v3: %w", err)
			}
			version = 3
		case 3:
			// Migrate from version 3 to 4: add tool_result column to messages table
			if err := db.migrateV3ToV4(); err != nil {
				return fmt.Errorf("migrate v3 to v4: %w", err)
			}
			version = 4
		case 4:
			// add airplane_mode column to settings table
			if err := db.migrateV4ToV5(); err != nil {
				return fmt.Errorf("migrate v4 to v5: %w", err)
			}
			version = 5
		case 5:
			// add turbo_enabled column to settings table
			if err := db.migrateV5ToV6(); err != nil {
				return fmt.Errorf("migrate v5 to v6: %w", err)
			}
			version = 6
		case 6:
			// add missing index for attachments table
			if err := db.migrateV6ToV7(); err != nil {
				return fmt.Errorf("migrate v6 to v7: %w", err)
			}
			version = 7
		case 7:
			// add think_enabled and think_level columns to settings table
			if err := db.migrateV7ToV8(); err != nil {
				return fmt.Errorf("migrate v7 to v8: %w", err)
			}
			version = 8
		case 8:
			// add browser_state column to chats table
			if err := db.migrateV8ToV9(); err != nil {
				return fmt.Errorf("migrate v8 to v9: %w", err)
			}
			version = 9
		case 9:
			// add cached user table
			if err := db.migrateV9ToV10(); err != nil {
				return fmt.Errorf("migrate v9 to v10: %w", err)
			}
			version = 10
		case 10:
			// remove remote column from settings table
			if err := db.migrateV10ToV11(); err != nil {
				return fmt.Errorf("migrate v10 to v11: %w", err)
			}
			version = 11
		case 11:
			// bring back remote column for backwards compatibility (deprecated)
			if err := db.migrateV11ToV12(); err != nil {
				return fmt.Errorf("migrate v11 to v12: %w", err)
			}
			version = 12
		case 12:
			// add cloud_setting_migrated column to settings table
			if err := db.migrateV12ToV13(); err != nil {
				return fmt.Errorf("migrate v12 to v13: %w", err)
			}
			version = 13
		case 13:
			// change default context_length from 4096 to 0 (VRAM-based tiered defaults)
			if err := db.migrateV13ToV14(); err != nil {
				return fmt.Errorf("migrate v13 to v14: %w", err)
			}
			version = 14
		case 14:
			// add auto_update_enabled column to settings table
			if err := db.migrateV14ToV15(); err != nil {
				return fmt.Errorf("migrate v14 to v15: %w", err)
			}
			version = 15
		case 15:
			// add last_home_view column to settings table
			if err := db.migrateV15ToV16(); err != nil {
				return fmt.Errorf("migrate v15 to v16: %w", err)
			}
			version = 16
		case 16:
			// add stats column to messages table
			if err := db.migrateV16ToV17(); err != nil {
				return fmt.Errorf("migrate v16 to v17: %w", err)
			}
			version = 17
		case 17:
			// add context notice and warning columns to messages table
			if err := db.migrateV17ToV18(); err != nil {
				return fmt.Errorf("migrate v17 to v18: %w", err)
			}
			version = 18
		case 18:
			if err := db.migrateV18ToV19(); err != nil {
				return fmt.Errorf("migrate v18 to v19: %w", err)
			}
			version = 19
		case 19:
			if err := db.migrateV19ToV20(); err != nil {
				return fmt.Errorf("migrate v19 to v20: %w", err)
			}
			version = 20
		case 20:
			if err := db.migrateV20ToV21(); err != nil {
				return fmt.Errorf("migrate v20 to v21: %w", err)
			}
			version = 21
		case 21:
			if err := db.migrateV21ToV22(); err != nil {
				return fmt.Errorf("migrate v21 to v22: %w", err)
			}
			version = 22
		default:
			// If we have a version we don't recognize, just set it to current
			// This might happen during development
			version = currentSchemaVersion
		}
	}

	return nil
}

// migrateV1ToV2 adds the context_length column to the settings table
func (db *database) migrateV1ToV2() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN context_length INTEGER NOT NULL DEFAULT 4096;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add context_length column: %w", err)
	}

	_, err = db.conn.Exec(`ALTER TABLE settings ADD COLUMN survey BOOLEAN NOT NULL DEFAULT TRUE;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add survey column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 2;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

// migrateV2ToV3 creates the attachments table
func (db *database) migrateV2ToV3() error {
	_, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS attachments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id INTEGER NOT NULL,
			filename TEXT NOT NULL,
			data BLOB NOT NULL,
			FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return fmt.Errorf("create attachments table: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 3`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

func (db *database) migrateV3ToV4() error {
	_, err := db.conn.Exec(`ALTER TABLE messages ADD COLUMN tool_result TEXT;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add tool_result column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 4;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

// migrateV4ToV5 adds the airplane_mode column to the settings table
func (db *database) migrateV4ToV5() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN airplane_mode BOOLEAN NOT NULL DEFAULT 0;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add airplane_mode column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 5;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

// migrateV5ToV6 adds the turbo_enabled, websearch_enabled, selected_model, sidebar_open columns to the settings table
func (db *database) migrateV5ToV6() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN turbo_enabled BOOLEAN NOT NULL DEFAULT 0;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add turbo_enabled column: %w", err)
	}

	_, err = db.conn.Exec(`ALTER TABLE settings ADD COLUMN websearch_enabled BOOLEAN NOT NULL DEFAULT 0;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add websearch_enabled column: %w", err)
	}

	_, err = db.conn.Exec(`ALTER TABLE settings ADD COLUMN selected_model TEXT NOT NULL DEFAULT '';`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add selected_model column: %w", err)
	}

	_, err = db.conn.Exec(`ALTER TABLE settings ADD COLUMN sidebar_open BOOLEAN NOT NULL DEFAULT 0;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add sidebar_open column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 6;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

// migrateV6ToV7 adds the missing index for the attachments table
func (db *database) migrateV6ToV7() error {
	_, err := db.conn.Exec(`CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);`)
	if err != nil {
		return fmt.Errorf("create attachments index: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 7;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

// migrateV7ToV8 adds the think_enabled and think_level columns to the settings table
func (db *database) migrateV7ToV8() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN think_enabled BOOLEAN NOT NULL DEFAULT 0;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add think_enabled column: %w", err)
	}

	_, err = db.conn.Exec(`ALTER TABLE settings ADD COLUMN think_level TEXT NOT NULL DEFAULT '';`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add think_level column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 8;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

// migrateV8ToV9 adds browser_state to chats and bumps schema
func (db *database) migrateV8ToV9() error {
	_, err := db.conn.Exec(`
		ALTER TABLE chats ADD COLUMN browser_state TEXT;
		UPDATE settings SET schema_version = 9;
	`)

	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add browser_state column: %w", err)
	}

	return nil
}

// migrateV9ToV10 adds users table
func (db *database) migrateV9ToV10() error {
	_, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			name TEXT NOT NULL DEFAULT '',
			email TEXT NOT NULL DEFAULT '',
			plan TEXT NOT NULL DEFAULT '',
			cached_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		UPDATE settings SET schema_version = 10;
	`)
	if err != nil {
		return fmt.Errorf("create users table: %w", err)
	}

	return nil
}

// migrateV10ToV11 removes the remote column from the settings table
func (db *database) migrateV10ToV11() error {
	_, err := db.conn.Exec(`ALTER TABLE settings DROP COLUMN remote`)
	if err != nil && !columnNotExists(err) {
		return fmt.Errorf("drop remote column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 11`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

// migrateV11ToV12 brings back the remote column for backwards compatibility (deprecated)
func (db *database) migrateV11ToV12() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN remote TEXT NOT NULL DEFAULT ''`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add remote column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 12`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

// migrateV12ToV13 adds cloud_setting_migrated to settings.
func (db *database) migrateV12ToV13() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN cloud_setting_migrated BOOLEAN NOT NULL DEFAULT 0`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add cloud_setting_migrated column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 13`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

// migrateV13ToV14 changes the default context_length from 4096 to 0.
// When context_length is 0, the ollama server uses VRAM-based tiered defaults.
func (db *database) migrateV13ToV14() error {
	_, err := db.conn.Exec(`UPDATE settings SET context_length = 0 WHERE context_length = 4096`)
	if err != nil {
		return fmt.Errorf("update context_length default: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 14`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

// migrateV14ToV15 adds the auto_update_enabled column to the settings table
func (db *database) migrateV14ToV15() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN auto_update_enabled BOOLEAN NOT NULL DEFAULT 1`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add auto_update_enabled column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 15`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

// migrateV15ToV16 adds the last_home_view column to the settings table
func (db *database) migrateV15ToV16() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN last_home_view TEXT NOT NULL DEFAULT 'launch'`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add last_home_view column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 16`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

// migrateV16ToV17 adds the stats column to the messages table.
func (db *database) migrateV16ToV17() error {
	_, err := db.conn.Exec(`ALTER TABLE messages ADD COLUMN stats TEXT`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add stats column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 17`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

// migrateV17ToV18 adds context notice and warning columns to the messages table.
func (db *database) migrateV17ToV18() error {
	_, err := db.conn.Exec(`ALTER TABLE messages ADD COLUMN context_notice TEXT`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add context_notice column: %w", err)
	}

	_, err = db.conn.Exec(`ALTER TABLE messages ADD COLUMN context_warnings TEXT`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add context_warnings column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 18`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

// migrateV18ToV19 adds cached vector embeddings for semantic retrieval.
func (db *database) migrateV18ToV19() error {
	_, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS message_embeddings (
			chat_id TEXT NOT NULL,
			model TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			dimensions INTEGER NOT NULL,
			embedding BLOB NOT NULL,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (chat_id, model, content_hash),
			FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS idx_message_embeddings_chat_model ON message_embeddings(chat_id, model);
		UPDATE settings SET schema_version = 19;
	`)
	if err != nil {
		return fmt.Errorf("create message_embeddings table: %w", err)
	}

	return nil
}

// migrateV19ToV20 adds vector-memory indexes used by cross-chat retrieval.
func (db *database) migrateV19ToV20() error {
	_, err := db.conn.Exec(`
		CREATE INDEX IF NOT EXISTS idx_messages_updated_at ON messages(updated_at);
		CREATE INDEX IF NOT EXISTS idx_message_embeddings_model ON message_embeddings(model);
		UPDATE settings SET schema_version = 20;
	`)
	if err != nil {
		return fmt.Errorf("create vector retrieval indexes: %w", err)
	}

	return nil
}

// cleanupOrphanedData removes orphaned records that may exist due to the foreign key bug
func (db *database) cleanupOrphanedData() error {
	_, err := db.conn.Exec(`
		DELETE FROM tool_calls
		WHERE message_id NOT IN (SELECT id FROM messages)
	`)
	if err != nil {
		return fmt.Errorf("cleanup orphaned tool_calls: %w", err)
	}

	_, err = db.conn.Exec(`
		DELETE FROM attachments
		WHERE message_id NOT IN (SELECT id FROM messages)
	`)
	if err != nil {
		return fmt.Errorf("cleanup orphaned attachments: %w", err)
	}

	_, err = db.conn.Exec(`
		DELETE FROM message_embeddings
		WHERE chat_id NOT IN (SELECT id FROM chats)
	`)
	if err != nil {
		return fmt.Errorf("cleanup orphaned message_embeddings: %w", err)
	}

	_, err = db.conn.Exec(`
		DELETE FROM messages
		WHERE chat_id NOT IN (SELECT id FROM chats)
	`)
	if err != nil {
		return fmt.Errorf("cleanup orphaned messages: %w", err)
	}

	return nil
}

func duplicateColumnError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "duplicate column name")
}

func columnNotExists(err error) bool {
	return err != nil && strings.Contains(err.Error(), "no such column")
}

func (db *database) getAllChats() ([]Chat, error) {
	// Query chats with their first user message and latest update time
	query := `
		SELECT 
			c.id, 
			c.title, 
			c.created_at,
			COALESCE(first_msg.content, '') as first_user_content,
			COALESCE(datetime(MAX(m.updated_at)), datetime(c.created_at)) as last_updated
		FROM chats c
		LEFT JOIN (
			SELECT chat_id, content, MIN(id) as min_id
			FROM messages
			WHERE role = 'user'
			GROUP BY chat_id
		) first_msg ON c.id = first_msg.chat_id
		LEFT JOIN messages m ON c.id = m.chat_id
		GROUP BY c.id, c.title, c.created_at, first_msg.content
		ORDER BY last_updated DESC
	`

	rows, err := db.conn.Query(query)
	if err != nil {
		return nil, fmt.Errorf("query chats: %w", err)
	}
	defer rows.Close()

	var chats []Chat
	for rows.Next() {
		var chat Chat
		var createdAt time.Time
		var firstUserContent string
		var lastUpdatedStr string

		err := rows.Scan(
			&chat.ID,
			&chat.Title,
			&createdAt,
			&firstUserContent,
			&lastUpdatedStr,
		)

		// Parse the last updated time
		lastUpdated, _ := time.Parse("2006-01-02 15:04:05", lastUpdatedStr)
		if err != nil {
			return nil, fmt.Errorf("scan chat: %w", err)
		}

		chat.Title, err = db.decryptString(chat.Title)
		if err != nil {
			return nil, fmt.Errorf("decrypt chat title: %w", err)
		}
		firstUserContent, err = db.decryptString(firstUserContent)
		if err != nil {
			return nil, fmt.Errorf("decrypt first message: %w", err)
		}

		chat.CreatedAt = createdAt

		// Add a dummy first user message for the UI to display
		// This is just for the excerpt, full messages are loaded when needed
		chat.Messages = []Message{}
		if firstUserContent != "" {
			chat.Messages = append(chat.Messages, Message{
				Role:      "user",
				Content:   firstUserContent,
				UpdatedAt: lastUpdated,
			})
		}

		chats = append(chats, chat)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate chats: %w", err)
	}

	return chats, nil
}

func (db *database) getChatWithOptions(id string, loadAttachmentData bool) (*Chat, error) {
	query := `
		SELECT id, title, created_at, browser_state
		FROM chats
		WHERE id = ?
	`

	var chat Chat
	var createdAt time.Time
	var browserState sql.NullString

	err := db.conn.QueryRow(query, id).Scan(
		&chat.ID,
		&chat.Title,
		&createdAt,
		&browserState,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("chat not found")
		}
		return nil, fmt.Errorf("query chat: %w", err)
	}

	chat.Title, err = db.decryptString(chat.Title)
	if err != nil {
		return nil, fmt.Errorf("decrypt chat title: %w", err)
	}
	browserState, err = db.decryptNullString(browserState)
	if err != nil {
		return nil, fmt.Errorf("decrypt browser state: %w", err)
	}

	chat.CreatedAt = createdAt
	if browserState.Valid && browserState.String != "" {
		var raw json.RawMessage
		if err := json.Unmarshal([]byte(browserState.String), &raw); err == nil {
			chat.BrowserState = raw
		}
	}

	messages, err := db.getMessages(id, loadAttachmentData)
	if err != nil {
		return nil, fmt.Errorf("get messages: %w", err)
	}
	chat.Messages = messages

	return &chat, nil
}

func (db *database) saveChat(chat Chat) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Use COALESCE for browser_state to avoid wiping an existing
	// chat-level browser_state when saving a chat that doesn't include a new state payload.
	// Many code paths call SetChat to update metadata/messages only; without COALESCE the
	// UPSERT would overwrite browser_state with NULL, breaking revisit rendering that relies
	// on the last persisted full tool state.
	query := `
		INSERT INTO chats (id, title, created_at, browser_state)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			title = excluded.title,
			browser_state = COALESCE(excluded.browser_state, chats.browser_state)
	`

	var browserState sql.NullString
	if chat.BrowserState != nil {
		browserState = sql.NullString{String: string(chat.BrowserState), Valid: true}
	}
	title, err := db.encryptString(chat.Title)
	if err != nil {
		return fmt.Errorf("encrypt chat title: %w", err)
	}
	browserState, err = db.encryptNullString(browserState)
	if err != nil {
		return fmt.Errorf("encrypt browser state: %w", err)
	}

	_, err = tx.Exec(query,
		chat.ID,
		title,
		chat.CreatedAt,
		browserState,
	)
	if err != nil {
		return fmt.Errorf("save chat: %w", err)
	}

	// Delete existing messages (we'll re-insert all)
	_, err = tx.Exec("DELETE FROM messages WHERE chat_id = ?", chat.ID)
	if err != nil {
		return fmt.Errorf("delete messages: %w", err)
	}

	// Insert messages
	for _, msg := range chat.Messages {
		messageID, err := db.insertMessage(tx, chat.ID, msg)
		if err != nil {
			return fmt.Errorf("insert message: %w", err)
		}

		// Insert tool calls if any
		for _, toolCall := range msg.ToolCalls {
			err := db.insertToolCall(tx, messageID, toolCall)
			if err != nil {
				return fmt.Errorf("insert tool call: %w", err)
			}
		}
	}

	return tx.Commit()
}

// updateChatBrowserState updates only the browser_state for a chat
func (db *database) updateChatBrowserState(chatID string, state json.RawMessage) error {
	encryptedState, err := db.encryptString(string(state))
	if err != nil {
		return fmt.Errorf("encrypt chat browser state: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE chats SET browser_state = ? WHERE id = ?`, encryptedState, chatID)
	if err != nil {
		return fmt.Errorf("update chat browser state: %w", err)
	}
	return nil
}

func (db *database) deleteChat(id string) error {
	_, err := db.conn.Exec("DELETE FROM chats WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete chat: %w", err)
	}

	_, _ = db.conn.Exec("PRAGMA wal_checkpoint(TRUNCATE);")

	return nil
}

// migrateV20ToV21 adds web search metadata to assistant messages.
func (db *database) migrateV20ToV21() error {
	_, err := db.conn.Exec(`ALTER TABLE messages ADD COLUMN web_search_metadata TEXT`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add web_search_metadata column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 21`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

// migrateV21ToV22 adds an app metadata table for local store state.
func (db *database) migrateV21ToV22() error {
	_, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS app_metadata (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL DEFAULT ''
		)
	`)
	if err != nil {
		return fmt.Errorf("create app_metadata table: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 22`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}

	return nil
}

func (db *database) updateLastMessage(chatID string, msg Message) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Get the ID of the last message
	var messageID int64
	err = tx.QueryRow(`
		SELECT MAX(id) FROM messages WHERE chat_id = ?
	`, chatID).Scan(&messageID)
	if err != nil {
		return fmt.Errorf("get last message id: %w", err)
	}

	query := `
		UPDATE messages 
		SET content = ?, thinking = ?, model_name = ?, updated_at = ?, thinking_time_start = ?, thinking_time_end = ?, tool_result = ?, stats = ?, context_notice = ?, context_warnings = ?, web_search_metadata = ?
		WHERE id = ?
	`

	var thinkingTimeStart, thinkingTimeEnd sql.NullTime
	if msg.ThinkingTimeStart != nil {
		thinkingTimeStart = sql.NullTime{Time: *msg.ThinkingTimeStart, Valid: true}
	}
	if msg.ThinkingTimeEnd != nil {
		thinkingTimeEnd = sql.NullTime{Time: *msg.ThinkingTimeEnd, Valid: true}
	}

	var modelName sql.NullString
	if msg.Model != "" {
		modelName = sql.NullString{String: msg.Model, Valid: true}
	}

	var toolResultJSON sql.NullString
	if msg.ToolResult != nil {
		resultBytes, err := json.Marshal(msg.ToolResult)
		if err != nil {
			return fmt.Errorf("marshal tool result: %w", err)
		}
		toolResultJSON = sql.NullString{String: string(resultBytes), Valid: true}
	}

	statsJSON, err := messageStatsSQL(msg.Stats)
	if err != nil {
		return err
	}
	contextNoticeJSON, err := messageContextNoticeSQL(msg.ContextNotice)
	if err != nil {
		return err
	}
	contextWarningsJSON, err := messageContextWarningsSQL(msg.ContextWarnings)
	if err != nil {
		return err
	}
	webSearchMetadataJSON, err := messageWebSearchMetadataSQL(msg)
	if err != nil {
		return err
	}
	content, err := db.encryptString(msg.Content)
	if err != nil {
		return fmt.Errorf("encrypt message content: %w", err)
	}
	thinking, err := db.encryptString(msg.Thinking)
	if err != nil {
		return fmt.Errorf("encrypt message thinking: %w", err)
	}
	toolResultJSON, err = db.encryptNullString(toolResultJSON)
	if err != nil {
		return fmt.Errorf("encrypt tool result: %w", err)
	}
	statsJSON, err = db.encryptNullString(statsJSON)
	if err != nil {
		return fmt.Errorf("encrypt response stats: %w", err)
	}
	contextNoticeJSON, err = db.encryptNullString(contextNoticeJSON)
	if err != nil {
		return fmt.Errorf("encrypt context notice: %w", err)
	}
	contextWarningsJSON, err = db.encryptNullString(contextWarningsJSON)
	if err != nil {
		return fmt.Errorf("encrypt context warnings: %w", err)
	}
	webSearchMetadataJSON, err = db.encryptNullString(webSearchMetadataJSON)
	if err != nil {
		return fmt.Errorf("encrypt web search metadata: %w", err)
	}

	result, err := tx.Exec(query,
		content,
		thinking,
		modelName,
		msg.UpdatedAt,
		thinkingTimeStart,
		thinkingTimeEnd,
		toolResultJSON,
		statsJSON,
		contextNoticeJSON,
		contextWarningsJSON,
		webSearchMetadataJSON,
		messageID,
	)
	if err != nil {
		return fmt.Errorf("update last message: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("no message found to update")
	}

	_, err = tx.Exec("DELETE FROM attachments WHERE message_id = ?", messageID)
	if err != nil {
		return fmt.Errorf("delete existing attachments: %w", err)
	}
	for _, att := range msg.Attachments {
		err := db.insertAttachment(tx, messageID, att)
		if err != nil {
			return fmt.Errorf("insert attachment: %w", err)
		}
	}

	_, err = tx.Exec("DELETE FROM tool_calls WHERE message_id = ?", messageID)
	if err != nil {
		return fmt.Errorf("delete existing tool calls: %w", err)
	}
	for _, toolCall := range msg.ToolCalls {
		err := db.insertToolCall(tx, messageID, toolCall)
		if err != nil {
			return fmt.Errorf("insert tool call: %w", err)
		}
	}

	return tx.Commit()
}

func (db *database) appendMessage(chatID string, msg Message) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	messageID, err := db.insertMessage(tx, chatID, msg)
	if err != nil {
		return fmt.Errorf("insert message: %w", err)
	}

	// Insert tool calls if any
	for _, toolCall := range msg.ToolCalls {
		err := db.insertToolCall(tx, messageID, toolCall)
		if err != nil {
			return fmt.Errorf("insert tool call: %w", err)
		}
	}

	return tx.Commit()
}

func (db *database) getMessages(chatID string, loadAttachmentData bool) ([]Message, error) {
	query := `
		SELECT id, role, content, thinking, stream, model_name, created_at, updated_at, thinking_time_start, thinking_time_end, tool_result, stats, context_notice, context_warnings, web_search_metadata
		FROM messages
		WHERE chat_id = ?
		ORDER BY id ASC
	`

	rows, err := db.conn.Query(query, chatID)
	if err != nil {
		return nil, fmt.Errorf("query messages: %w", err)
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var msg Message
		var messageID int64
		var thinkingTimeStart, thinkingTimeEnd sql.NullTime
		var modelName sql.NullString
		var toolResult sql.NullString
		var stats sql.NullString
		var contextNotice sql.NullString
		var contextWarnings sql.NullString
		var webSearchMetadata sql.NullString

		err := rows.Scan(
			&messageID,
			&msg.Role,
			&msg.Content,
			&msg.Thinking,
			&msg.Stream,
			&modelName,
			&msg.CreatedAt,
			&msg.UpdatedAt,
			&thinkingTimeStart,
			&thinkingTimeEnd,
			&toolResult,
			&stats,
			&contextNotice,
			&contextWarnings,
			&webSearchMetadata,
		)
		if err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}

		msg.Content, err = db.decryptString(msg.Content)
		if err != nil {
			return nil, fmt.Errorf("decrypt message content: %w", err)
		}
		msg.Thinking, err = db.decryptString(msg.Thinking)
		if err != nil {
			return nil, fmt.Errorf("decrypt message thinking: %w", err)
		}
		toolResult, err = db.decryptNullString(toolResult)
		if err != nil {
			return nil, fmt.Errorf("decrypt tool result: %w", err)
		}
		stats, err = db.decryptNullString(stats)
		if err != nil {
			return nil, fmt.Errorf("decrypt response stats: %w", err)
		}
		contextNotice, err = db.decryptNullString(contextNotice)
		if err != nil {
			return nil, fmt.Errorf("decrypt context notice: %w", err)
		}
		contextWarnings, err = db.decryptNullString(contextWarnings)
		if err != nil {
			return nil, fmt.Errorf("decrypt context warnings: %w", err)
		}
		webSearchMetadata, err = db.decryptNullString(webSearchMetadata)
		if err != nil {
			return nil, fmt.Errorf("decrypt web search metadata: %w", err)
		}

		attachments, err := db.getAttachments(messageID, loadAttachmentData)
		if err != nil {
			return nil, fmt.Errorf("get attachments: %w", err)
		}
		msg.Attachments = attachments

		if thinkingTimeStart.Valid {
			msg.ThinkingTimeStart = &thinkingTimeStart.Time
		}
		if thinkingTimeEnd.Valid {
			msg.ThinkingTimeEnd = &thinkingTimeEnd.Time
		}

		// Parse tool result from JSON if present
		if toolResult.Valid && toolResult.String != "" {
			var result json.RawMessage
			if err := json.Unmarshal([]byte(toolResult.String), &result); err == nil {
				msg.ToolResult = &result
			}
		}

		if stats.Valid && stats.String != "" {
			var messageStats ResponseStats
			if err := json.Unmarshal([]byte(stats.String), &messageStats); err == nil {
				msg.Stats = &messageStats
			}
		}
		if contextNotice.Valid && contextNotice.String != "" {
			var notice ContextNotice
			if err := json.Unmarshal([]byte(contextNotice.String), &notice); err == nil {
				msg.ContextNotice = &notice
			}
		}
		if contextWarnings.Valid && contextWarnings.String != "" {
			var warnings []ContextWarning
			if err := json.Unmarshal([]byte(contextWarnings.String), &warnings); err == nil {
				msg.ContextWarnings = warnings
			}
		}
		if webSearchMetadata.Valid && webSearchMetadata.String != "" {
			var metadata WebSearchMetadata
			if err := json.Unmarshal([]byte(webSearchMetadata.String), &metadata); err == nil {
				msg.WebSearchMode = metadata.Mode
				msg.WebSearchProvider = metadata.Provider
				msg.WebSearchResults = metadata.Results
				msg.WebSearchError = metadata.Error
				msg.WebSearchReason = metadata.Reason
				msg.WebSearchSearched = metadata.Searched
			}
		}

		// Set model if present
		if modelName.Valid && modelName.String != "" {
			msg.Model = modelName.String
		}

		// Get tool calls for this message
		toolCalls, err := db.getToolCalls(messageID)
		if err != nil {
			return nil, fmt.Errorf("get tool calls: %w", err)
		}
		msg.ToolCalls = toolCalls

		messages = append(messages, msg)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate messages: %w", err)
	}

	return messages, nil
}

func (db *database) getVectorMemoryItems(chatID string) ([]VectorMemoryItem, error) {
	query := `
		SELECT c.id, c.title, m.id, m.role, m.content, m.thinking, m.model_name, m.created_at, m.updated_at, m.tool_result
		FROM messages m
		JOIN chats c ON c.id = m.chat_id
		WHERE m.chat_id = ?
		ORDER BY m.id ASC
	`

	rows, err := db.conn.Query(query, chatID)
	if err != nil {
		return nil, fmt.Errorf("query vector memory items: %w", err)
	}
	defer rows.Close()

	items, err := db.scanVectorMemoryItems(rows)
	if err != nil {
		return nil, err
	}

	return items, nil
}

func (db *database) getVectorMemoryItemsAllChats() ([]VectorMemoryItem, error) {
	query := `
		SELECT c.id, c.title, m.id, m.role, m.content, m.thinking, m.model_name, m.created_at, m.updated_at, m.tool_result
		FROM messages m
		JOIN chats c ON c.id = m.chat_id
		ORDER BY m.updated_at ASC, m.id ASC
	`

	rows, err := db.conn.Query(query)
	if err != nil {
		return nil, fmt.Errorf("query all vector memory items: %w", err)
	}
	defer rows.Close()

	items, err := db.scanVectorMemoryItems(rows)
	if err != nil {
		return nil, fmt.Errorf("scan all vector memory items: %w", err)
	}

	return items, nil
}

func (db *database) getVectorMemoryItemsForChats(chatIDs []string) ([]VectorMemoryItem, error) {
	if len(chatIDs) == 0 {
		return nil, nil
	}

	query := fmt.Sprintf(`
		SELECT c.id, c.title, m.id, m.role, m.content, m.thinking, m.model_name, m.created_at, m.updated_at, m.tool_result
		FROM messages m
		JOIN chats c ON c.id = m.chat_id
		WHERE m.chat_id IN (%s)
		ORDER BY m.updated_at ASC, m.id ASC
	`, sqlPlaceholders(len(chatIDs)))

	rows, err := db.conn.Query(query, stringArgs(chatIDs)...)
	if err != nil {
		return nil, fmt.Errorf("query selected vector memory items: %w", err)
	}
	defer rows.Close()

	items, err := db.scanVectorMemoryItems(rows)
	if err != nil {
		return nil, fmt.Errorf("scan selected vector memory items: %w", err)
	}

	return items, nil
}

func (db *database) scanVectorMemoryItems(rows *sql.Rows) ([]VectorMemoryItem, error) {
	var items []VectorMemoryItem
	for rows.Next() {
		var item VectorMemoryItem
		var modelName sql.NullString
		var toolResult sql.NullString

		err := rows.Scan(
			&item.ChatID,
			&item.ChatTitle,
			&item.MessageID,
			&item.Message.Role,
			&item.Message.Content,
			&item.Message.Thinking,
			&modelName,
			&item.Message.CreatedAt,
			&item.Message.UpdatedAt,
			&toolResult,
		)
		if err != nil {
			return nil, fmt.Errorf("scan vector memory item: %w", err)
		}

		item.ChatTitle, err = db.decryptString(item.ChatTitle)
		if err != nil {
			return nil, fmt.Errorf("decrypt vector chat title: %w", err)
		}
		item.Message.Content, err = db.decryptString(item.Message.Content)
		if err != nil {
			return nil, fmt.Errorf("decrypt vector message content: %w", err)
		}
		item.Message.Thinking, err = db.decryptString(item.Message.Thinking)
		if err != nil {
			return nil, fmt.Errorf("decrypt vector message thinking: %w", err)
		}
		toolResult, err = db.decryptNullString(toolResult)
		if err != nil {
			return nil, fmt.Errorf("decrypt vector tool result: %w", err)
		}

		if modelName.Valid {
			item.Message.Model = modelName.String
		}
		if toolResult.Valid && toolResult.String != "" {
			var result json.RawMessage
			if err := json.Unmarshal([]byte(toolResult.String), &result); err == nil {
				item.Message.ToolResult = &result
			}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate vector memory items: %w", err)
	}

	return items, nil
}

func (db *database) getVectorMemoryEmbeddings(chatID, model string) ([]VectorMemoryEmbedding, error) {
	rows, err := db.conn.Query(`
		SELECT chat_id, content_hash, embedding
		FROM message_embeddings
		WHERE chat_id = ? AND model = ?
	`, chatID, model)
	if err != nil {
		return nil, fmt.Errorf("query vector memory embeddings: %w", err)
	}
	defer rows.Close()

	var embeddings []VectorMemoryEmbedding
	for rows.Next() {
		var item VectorMemoryEmbedding
		var embeddingBytes []byte
		if err := rows.Scan(&item.ChatID, &item.ContentHash, &embeddingBytes); err != nil {
			return nil, fmt.Errorf("scan vector memory embedding: %w", err)
		}
		embedding, err := decodeFloat32Vector(embeddingBytes)
		if err != nil {
			continue
		}
		item.Embedding = embedding
		embeddings = append(embeddings, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate vector memory embeddings: %w", err)
	}

	return embeddings, nil
}

func (db *database) getVectorMemoryEmbeddingsAllChats(model string) ([]VectorMemoryEmbedding, error) {
	rows, err := db.conn.Query(`
		SELECT chat_id, content_hash, embedding
		FROM message_embeddings
		WHERE model = ?
	`, model)
	if err != nil {
		return nil, fmt.Errorf("query all vector memory embeddings: %w", err)
	}
	defer rows.Close()

	var embeddings []VectorMemoryEmbedding
	for rows.Next() {
		var item VectorMemoryEmbedding
		var embeddingBytes []byte
		if err := rows.Scan(&item.ChatID, &item.ContentHash, &embeddingBytes); err != nil {
			return nil, fmt.Errorf("scan vector memory embedding: %w", err)
		}
		embedding, err := decodeFloat32Vector(embeddingBytes)
		if err != nil {
			continue
		}
		item.Embedding = embedding
		embeddings = append(embeddings, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate all vector memory embeddings: %w", err)
	}

	return embeddings, nil
}

func (db *database) getVectorMemoryEmbeddingsForChats(model string, chatIDs []string) ([]VectorMemoryEmbedding, error) {
	if len(chatIDs) == 0 {
		return nil, nil
	}

	args := make([]any, 0, len(chatIDs)+1)
	args = append(args, model)
	args = append(args, stringArgs(chatIDs)...)
	rows, err := db.conn.Query(fmt.Sprintf(`
		SELECT chat_id, content_hash, embedding
		FROM message_embeddings
		WHERE model = ? AND chat_id IN (%s)
	`, sqlPlaceholders(len(chatIDs))), args...)
	if err != nil {
		return nil, fmt.Errorf("query selected vector memory embeddings: %w", err)
	}
	defer rows.Close()

	var embeddings []VectorMemoryEmbedding
	for rows.Next() {
		var item VectorMemoryEmbedding
		var embeddingBytes []byte
		if err := rows.Scan(&item.ChatID, &item.ContentHash, &embeddingBytes); err != nil {
			return nil, fmt.Errorf("scan vector memory embedding: %w", err)
		}
		embedding, err := decodeFloat32Vector(embeddingBytes)
		if err != nil {
			continue
		}
		item.Embedding = embedding
		embeddings = append(embeddings, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate selected vector memory embeddings: %w", err)
	}

	return embeddings, nil
}

func sqlPlaceholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimRight(strings.Repeat("?,", count), ",")
}

func stringArgs(values []string) []any {
	args := make([]any, len(values))
	for i, value := range values {
		args[i] = value
	}
	return args
}

func (db *database) upsertMessageEmbedding(chatID, model, contentHash string, embedding []float32) error {
	if len(embedding) == 0 {
		return fmt.Errorf("embedding is empty")
	}

	encoded, err := encodeFloat32Vector(embedding)
	if err != nil {
		return err
	}

	_, err = db.conn.Exec(`
		INSERT INTO message_embeddings (chat_id, model, content_hash, dimensions, embedding, updated_at)
		VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(chat_id, model, content_hash) DO UPDATE SET
			dimensions = excluded.dimensions,
			embedding = excluded.embedding,
			updated_at = CURRENT_TIMESTAMP
	`, chatID, model, contentHash, len(embedding), encoded)
	if err != nil {
		return fmt.Errorf("upsert message embedding: %w", err)
	}

	return nil
}

func (db *database) insertMessage(tx *sql.Tx, chatID string, msg Message) (int64, error) {
	query := `
		INSERT INTO messages (chat_id, role, content, thinking, stream, model_name, created_at, updated_at, thinking_time_start, thinking_time_end, tool_result, stats, context_notice, context_warnings, web_search_metadata)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	var thinkingTimeStart, thinkingTimeEnd sql.NullTime
	if msg.ThinkingTimeStart != nil {
		thinkingTimeStart = sql.NullTime{Time: *msg.ThinkingTimeStart, Valid: true}
	}
	if msg.ThinkingTimeEnd != nil {
		thinkingTimeEnd = sql.NullTime{Time: *msg.ThinkingTimeEnd, Valid: true}
	}

	var modelName sql.NullString
	if msg.Model != "" {
		modelName = sql.NullString{String: msg.Model, Valid: true}
	}

	var toolResultJSON sql.NullString
	if msg.ToolResult != nil {
		resultBytes, err := json.Marshal(msg.ToolResult)
		if err != nil {
			return 0, fmt.Errorf("marshal tool result: %w", err)
		}
		toolResultJSON = sql.NullString{String: string(resultBytes), Valid: true}
	}

	statsJSON, err := messageStatsSQL(msg.Stats)
	if err != nil {
		return 0, err
	}
	contextNoticeJSON, err := messageContextNoticeSQL(msg.ContextNotice)
	if err != nil {
		return 0, err
	}
	contextWarningsJSON, err := messageContextWarningsSQL(msg.ContextWarnings)
	if err != nil {
		return 0, err
	}
	webSearchMetadataJSON, err := messageWebSearchMetadataSQL(msg)
	if err != nil {
		return 0, err
	}
	content, err := db.encryptString(msg.Content)
	if err != nil {
		return 0, fmt.Errorf("encrypt message content: %w", err)
	}
	thinking, err := db.encryptString(msg.Thinking)
	if err != nil {
		return 0, fmt.Errorf("encrypt message thinking: %w", err)
	}
	toolResultJSON, err = db.encryptNullString(toolResultJSON)
	if err != nil {
		return 0, fmt.Errorf("encrypt tool result: %w", err)
	}
	statsJSON, err = db.encryptNullString(statsJSON)
	if err != nil {
		return 0, fmt.Errorf("encrypt response stats: %w", err)
	}
	contextNoticeJSON, err = db.encryptNullString(contextNoticeJSON)
	if err != nil {
		return 0, fmt.Errorf("encrypt context notice: %w", err)
	}
	contextWarningsJSON, err = db.encryptNullString(contextWarningsJSON)
	if err != nil {
		return 0, fmt.Errorf("encrypt context warnings: %w", err)
	}
	webSearchMetadataJSON, err = db.encryptNullString(webSearchMetadataJSON)
	if err != nil {
		return 0, fmt.Errorf("encrypt web search metadata: %w", err)
	}

	result, err := tx.Exec(query,
		chatID,
		msg.Role,
		content,
		thinking,
		msg.Stream,
		modelName,
		msg.CreatedAt,
		msg.UpdatedAt,
		thinkingTimeStart,
		thinkingTimeEnd,
		toolResultJSON,
		statsJSON,
		contextNoticeJSON,
		contextWarningsJSON,
		webSearchMetadataJSON,
	)
	if err != nil {
		return 0, err
	}

	messageID, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}

	for _, att := range msg.Attachments {
		err := db.insertAttachment(tx, messageID, att)
		if err != nil {
			return 0, fmt.Errorf("insert attachment: %w", err)
		}
	}

	return messageID, nil
}

func messageStatsSQL(stats *ResponseStats) (sql.NullString, error) {
	if stats == nil {
		return sql.NullString{}, nil
	}

	statsBytes, err := json.Marshal(stats)
	if err != nil {
		return sql.NullString{}, fmt.Errorf("marshal response stats: %w", err)
	}

	return sql.NullString{String: string(statsBytes), Valid: true}, nil
}

func messageContextNoticeSQL(notice *ContextNotice) (sql.NullString, error) {
	if notice == nil {
		return sql.NullString{}, nil
	}

	noticeBytes, err := json.Marshal(notice)
	if err != nil {
		return sql.NullString{}, fmt.Errorf("marshal context notice: %w", err)
	}

	return sql.NullString{String: string(noticeBytes), Valid: true}, nil
}

func messageContextWarningsSQL(warnings []ContextWarning) (sql.NullString, error) {
	if len(warnings) == 0 {
		return sql.NullString{}, nil
	}

	warningBytes, err := json.Marshal(warnings)
	if err != nil {
		return sql.NullString{}, fmt.Errorf("marshal context warnings: %w", err)
	}

	return sql.NullString{String: string(warningBytes), Valid: true}, nil
}

func messageWebSearchMetadataSQL(msg Message) (sql.NullString, error) {
	metadata := WebSearchMetadata{
		Mode:     strings.TrimSpace(msg.WebSearchMode),
		Provider: strings.TrimSpace(msg.WebSearchProvider),
		Results:  msg.WebSearchResults,
		Error:    strings.TrimSpace(msg.WebSearchError),
		Reason:   strings.TrimSpace(msg.WebSearchReason),
		Searched: msg.WebSearchSearched,
	}
	if metadata.Mode == "" &&
		metadata.Provider == "" &&
		len(metadata.Results) == 0 &&
		metadata.Error == "" &&
		metadata.Reason == "" &&
		metadata.Searched == nil {
		return sql.NullString{}, nil
	}

	metadataBytes, err := json.Marshal(metadata)
	if err != nil {
		return sql.NullString{}, fmt.Errorf("marshal web search metadata: %w", err)
	}

	return sql.NullString{String: string(metadataBytes), Valid: true}, nil
}

func encodeFloat32Vector(vector []float32) ([]byte, error) {
	buffer := bytes.NewBuffer(make([]byte, 0, len(vector)*4))
	for _, value := range vector {
		if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
			return nil, fmt.Errorf("embedding contains non-finite value")
		}
		if err := binary.Write(buffer, binary.LittleEndian, value); err != nil {
			return nil, fmt.Errorf("encode embedding: %w", err)
		}
	}
	return buffer.Bytes(), nil
}

func decodeFloat32Vector(data []byte) ([]float32, error) {
	if len(data)%4 != 0 {
		return nil, fmt.Errorf("invalid embedding byte length")
	}

	vector := make([]float32, len(data)/4)
	reader := bytes.NewReader(data)
	for i := range vector {
		if err := binary.Read(reader, binary.LittleEndian, &vector[i]); err != nil {
			return nil, fmt.Errorf("decode embedding: %w", err)
		}
	}
	return vector, nil
}

func (db *database) getAttachments(messageID int64, loadData bool) ([]File, error) {
	var query string
	if loadData {
		query = `
			SELECT filename, data
			FROM attachments
			WHERE message_id = ?
			ORDER BY id ASC
		`
	} else {
		query = `
			SELECT filename, '' as data
			FROM attachments
			WHERE message_id = ?
			ORDER BY id ASC
		`
	}

	rows, err := db.conn.Query(query, messageID)
	if err != nil {
		return nil, fmt.Errorf("query attachments: %w", err)
	}
	defer rows.Close()

	var attachments []File
	for rows.Next() {
		var file File
		err := rows.Scan(&file.Filename, &file.Data)
		if err != nil {
			return nil, fmt.Errorf("scan attachment: %w", err)
		}
		file.Filename, err = db.decryptString(file.Filename)
		if err != nil {
			return nil, fmt.Errorf("decrypt attachment filename: %w", err)
		}
		file.Data, err = db.decryptBytes(file.Data)
		if err != nil {
			return nil, fmt.Errorf("decrypt attachment data: %w", err)
		}
		attachments = append(attachments, file)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate attachments: %w", err)
	}

	return attachments, nil
}

func (db *database) getToolCalls(messageID int64) ([]ToolCall, error) {
	query := `
		SELECT type, function_name, function_arguments, function_result
		FROM tool_calls
		WHERE message_id = ?
		ORDER BY id ASC
	`

	rows, err := db.conn.Query(query, messageID)
	if err != nil {
		return nil, fmt.Errorf("query tool calls: %w", err)
	}
	defer rows.Close()

	var toolCalls []ToolCall
	for rows.Next() {
		var tc ToolCall
		var functionResult sql.NullString

		err := rows.Scan(
			&tc.Type,
			&tc.Function.Name,
			&tc.Function.Arguments,
			&functionResult,
		)
		if err != nil {
			return nil, fmt.Errorf("scan tool call: %w", err)
		}
		tc.Function.Arguments, err = db.decryptString(tc.Function.Arguments)
		if err != nil {
			return nil, fmt.Errorf("decrypt tool arguments: %w", err)
		}
		functionResult, err = db.decryptNullString(functionResult)
		if err != nil {
			return nil, fmt.Errorf("decrypt tool result: %w", err)
		}

		if functionResult.Valid && functionResult.String != "" {
			// Parse the JSON result
			var result json.RawMessage
			if err := json.Unmarshal([]byte(functionResult.String), &result); err == nil {
				tc.Function.Result = &result
			}
		}

		toolCalls = append(toolCalls, tc)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tool calls: %w", err)
	}

	return toolCalls, nil
}

func (db *database) insertAttachment(tx *sql.Tx, messageID int64, file File) error {
	query := `
		INSERT INTO attachments (message_id, filename, data)
		VALUES (?, ?, ?)
	`
	filename, err := db.encryptString(file.Filename)
	if err != nil {
		return fmt.Errorf("encrypt attachment filename: %w", err)
	}
	data, err := db.encryptBytes(file.Data)
	if err != nil {
		return fmt.Errorf("encrypt attachment data: %w", err)
	}
	_, err = tx.Exec(query, messageID, filename, data)
	return err
}

func (db *database) insertToolCall(tx *sql.Tx, messageID int64, tc ToolCall) error {
	query := `
		INSERT INTO tool_calls (message_id, type, function_name, function_arguments, function_result)
		VALUES (?, ?, ?, ?, ?)
	`

	var functionResult sql.NullString
	if tc.Function.Result != nil {
		// Convert result to JSON
		resultJSON, err := json.Marshal(tc.Function.Result)
		if err != nil {
			return fmt.Errorf("marshal tool result: %w", err)
		}
		functionResult = sql.NullString{String: string(resultJSON), Valid: true}
	}
	functionArguments, err := db.encryptString(tc.Function.Arguments)
	if err != nil {
		return fmt.Errorf("encrypt tool arguments: %w", err)
	}
	functionResult, err = db.encryptNullString(functionResult)
	if err != nil {
		return fmt.Errorf("encrypt tool result: %w", err)
	}

	_, err = tx.Exec(query,
		messageID,
		tc.Type,
		tc.Function.Name,
		functionArguments,
		functionResult,
	)
	return err
}

// Settings operations

func (db *database) getID() (string, error) {
	var id string
	err := db.conn.QueryRow("SELECT device_id FROM settings").Scan(&id)
	if err != nil {
		return "", fmt.Errorf("get device id: %w", err)
	}
	return id, nil
}

func (db *database) setID(id string) error {
	_, err := db.conn.Exec("UPDATE settings SET device_id = ?", id)
	if err != nil {
		return fmt.Errorf("set device id: %w", err)
	}
	return nil
}

func (db *database) getHasCompletedFirstRun() (bool, error) {
	var hasCompletedFirstRun bool
	err := db.conn.QueryRow("SELECT has_completed_first_run FROM settings").Scan(&hasCompletedFirstRun)
	if err != nil {
		return false, fmt.Errorf("get has completed first run: %w", err)
	}
	return hasCompletedFirstRun, nil
}

func (db *database) setHasCompletedFirstRun(hasCompletedFirstRun bool) error {
	_, err := db.conn.Exec("UPDATE settings SET has_completed_first_run = ?", hasCompletedFirstRun)
	if err != nil {
		return fmt.Errorf("set has completed first run: %w", err)
	}
	return nil
}

func (db *database) getSettings() (Settings, error) {
	var s Settings

	err := db.conn.QueryRow(`
		SELECT expose, survey, browser, models, agent, tools, working_dir, context_length, turbo_enabled, websearch_enabled, selected_model, sidebar_open, last_home_view, think_enabled, think_level, auto_update_enabled
		FROM settings
	`).Scan(&s.Expose, &s.Survey, &s.Browser, &s.Models, &s.Agent, &s.Tools, &s.WorkingDir, &s.ContextLength, &s.TurboEnabled, &s.WebSearchEnabled, &s.SelectedModel, &s.SidebarOpen, &s.LastHomeView, &s.ThinkEnabled, &s.ThinkLevel, &s.AutoUpdateEnabled)
	if err != nil {
		return Settings{}, fmt.Errorf("get settings: %w", err)
	}

	return s, nil
}

func (db *database) setSettings(s Settings) error {
	lastHomeView := strings.ToLower(strings.TrimSpace(s.LastHomeView))
	validLaunchView := map[string]struct{}{
		"launch":    {},
		"openclaw":  {},
		"claude":    {},
		"hermes":    {},
		"codex":     {},
		"codex-app": {},
		"copilot":   {},
		"opencode":  {},
		"droid":     {},
		"pi":        {},
	}
	if lastHomeView != "chat" {
		if _, ok := validLaunchView[lastHomeView]; !ok {
			lastHomeView = "launch"
		}
	}

	_, err := db.conn.Exec(`
		UPDATE settings
		SET expose = ?, survey = ?, browser = ?, models = ?, agent = ?, tools = ?, working_dir = ?, context_length = ?, turbo_enabled = ?, websearch_enabled = ?, selected_model = ?, sidebar_open = ?, last_home_view = ?, think_enabled = ?, think_level = ?, auto_update_enabled = ?
	`, s.Expose, s.Survey, s.Browser, s.Models, s.Agent, s.Tools, s.WorkingDir, s.ContextLength, s.TurboEnabled, s.WebSearchEnabled, s.SelectedModel, s.SidebarOpen, lastHomeView, s.ThinkEnabled, s.ThinkLevel, s.AutoUpdateEnabled)
	if err != nil {
		return fmt.Errorf("set settings: %w", err)
	}
	return nil
}

func (db *database) isCloudSettingMigrated() (bool, error) {
	var migrated bool
	err := db.conn.QueryRow("SELECT cloud_setting_migrated FROM settings").Scan(&migrated)
	if err != nil {
		return false, fmt.Errorf("get cloud setting migration status: %w", err)
	}
	return migrated, nil
}

func (db *database) setCloudSettingMigrated(migrated bool) error {
	_, err := db.conn.Exec("UPDATE settings SET cloud_setting_migrated = ?", migrated)
	if err != nil {
		return fmt.Errorf("set cloud setting migration status: %w", err)
	}
	return nil
}

func (db *database) getAirplaneMode() (bool, error) {
	var airplaneMode bool
	err := db.conn.QueryRow("SELECT airplane_mode FROM settings").Scan(&airplaneMode)
	if err != nil {
		return false, fmt.Errorf("get airplane_mode: %w", err)
	}
	return airplaneMode, nil
}

func (db *database) getWindowSize() (int, int, error) {
	var width, height int
	err := db.conn.QueryRow("SELECT window_width, window_height FROM settings").Scan(&width, &height)
	if err != nil {
		return 0, 0, fmt.Errorf("get window size: %w", err)
	}
	return width, height, nil
}

func (db *database) setWindowSize(width, height int) error {
	_, err := db.conn.Exec("UPDATE settings SET window_width = ?, window_height = ?", width, height)
	if err != nil {
		return fmt.Errorf("set window size: %w", err)
	}
	return nil
}

func (db *database) isConfigMigrated() (bool, error) {
	var migrated bool
	err := db.conn.QueryRow("SELECT config_migrated FROM settings").Scan(&migrated)
	if err != nil {
		return false, fmt.Errorf("get config migrated: %w", err)
	}
	return migrated, nil
}

func (db *database) setConfigMigrated(migrated bool) error {
	_, err := db.conn.Exec("UPDATE settings SET config_migrated = ?", migrated)
	if err != nil {
		return fmt.Errorf("set config migrated: %w", err)
	}
	return nil
}

func (db *database) getSchemaVersion() (int, error) {
	var version int
	err := db.conn.QueryRow("SELECT schema_version FROM settings").Scan(&version)
	if err != nil {
		return 0, fmt.Errorf("get schema version: %w", err)
	}
	return version, nil
}

func (db *database) setSchemaVersion(version int) error {
	_, err := db.conn.Exec("UPDATE settings SET schema_version = ?", version)
	if err != nil {
		return fmt.Errorf("set schema version: %w", err)
	}
	return nil
}

func (db *database) getUser() (*User, error) {
	var user User
	err := db.conn.QueryRow(`
		SELECT name, email, plan, cached_at
		FROM users
		LIMIT 1
	`).Scan(&user.Name, &user.Email, &user.Plan, &user.CachedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // No user cached yet
		}
		return nil, fmt.Errorf("get user: %w", err)
	}
	user.Name, err = db.decryptString(user.Name)
	if err != nil {
		return nil, fmt.Errorf("decrypt user name: %w", err)
	}
	user.Email, err = db.decryptString(user.Email)
	if err != nil {
		return nil, fmt.Errorf("decrypt user email: %w", err)
	}
	user.Plan, err = db.decryptString(user.Plan)
	if err != nil {
		return nil, fmt.Errorf("decrypt user plan: %w", err)
	}

	return &user, nil
}

func (db *database) setUser(user User) error {
	if err := db.clearUser(); err != nil {
		return fmt.Errorf("before set: %w", err)
	}

	name, err := db.encryptString(user.Name)
	if err != nil {
		return fmt.Errorf("encrypt user name: %w", err)
	}
	email, err := db.encryptString(user.Email)
	if err != nil {
		return fmt.Errorf("encrypt user email: %w", err)
	}
	plan, err := db.encryptString(user.Plan)
	if err != nil {
		return fmt.Errorf("encrypt user plan: %w", err)
	}

	_, err = db.conn.Exec(`
		INSERT INTO users (name, email, plan, cached_at)
		VALUES (?, ?, ?, ?)
	`, name, email, plan, user.CachedAt)
	if err != nil {
		return fmt.Errorf("set user: %w", err)
	}

	return nil
}

func (db *database) clearUser() error {
	_, err := db.conn.Exec("DELETE FROM users")
	if err != nil {
		return fmt.Errorf("clear user: %w", err)
	}
	return nil
}
