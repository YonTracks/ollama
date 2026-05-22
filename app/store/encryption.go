//go:build windows || darwin

package store

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/crypto/pbkdf2"

	"github.com/ollama/ollama/envconfig"
)

const (
	encryptedTextPrefix            = "ollamaenc:v1:"
	appDataEncryptionMetadataKey   = "app_data_encryption_sentinel"
	appDataEncryptionSaltKey       = "app_data_encryption_salt"
	appDataEncryptionSentinelValue = "ollama-app-data-encryption-v1"
	legacyAppDataKeySalt           = "ollama-app-sqlite-v1"
	appDataKeyRounds               = 210000
	appDataSaltBytes               = 32
)

var encryptedBlobPrefix = []byte(encryptedTextPrefix)

var (
	ErrAppDataEncryptionKeyMissing = errors.New("encrypted app data requires OLLAMA_APP_DATA_KEY")
	ErrAppDataEncryptionKeyInvalid = errors.New("encrypted app data could not be decrypted with OLLAMA_APP_DATA_KEY")
)

type AppDataEncryptionState string

const (
	AppDataEncryptionStatePlain      AppDataEncryptionState = "plain"
	AppDataEncryptionStateEnabled    AppDataEncryptionState = "enabled"
	AppDataEncryptionStateEncrypted  AppDataEncryptionState = "encrypted"
	AppDataEncryptionStateLegacy     AppDataEncryptionState = "legacy_encrypted"
	AppDataEncryptionStateKeyMissing AppDataEncryptionState = "key_missing"
	AppDataEncryptionStateKeyInvalid AppDataEncryptionState = "key_invalid"
	AppDataEncryptionStateUnknown    AppDataEncryptionState = "unknown"
)

type AppDataEncryptionStatus struct {
	State         AppDataEncryptionState
	Encrypted     bool
	KeyConfigured bool
	Disabled      bool
	Legacy        bool
	Error         string
}

type appDataTextColumn struct {
	table    string
	idColumn string
	column   string
}

type appDataBlobColumn struct {
	table    string
	idColumn string
	column   string
}

var sensitiveAppDataTextColumns = []appDataTextColumn{
	{"chats", "id", "title"},
	{"chats", "id", "browser_state"},
	{"messages", "id", "content"},
	{"messages", "id", "thinking"},
	{"messages", "id", "tool_result"},
	{"messages", "id", "stats"},
	{"messages", "id", "context_notice"},
	{"messages", "id", "context_warnings"},
	{"messages", "id", "web_search_metadata"},
	{"attachments", "id", "filename"},
	{"tool_calls", "id", "function_arguments"},
	{"tool_calls", "id", "function_result"},
	{"users", "rowid", "name"},
	{"users", "rowid", "email"},
	{"users", "rowid", "plan"},
}

var sensitiveAppDataBlobColumns = []appDataBlobColumn{
	{"attachments", "id", "data"},
}

type dataCipher struct {
	aead cipher.AEAD
}

func appDataKeyPassphrase() string {
	return strings.TrimSpace(envconfig.AppDataKey())
}

func newDataCipherFromEnv(salt []byte) (*dataCipher, error) {
	passphrase := appDataKeyPassphrase()
	if passphrase == "" {
		return nil, nil
	}
	return newDataCipher(passphrase, salt)
}

func newLegacyDataCipherFromEnv() (*dataCipher, error) {
	return newDataCipherFromEnv([]byte(legacyAppDataKeySalt))
}

func newDataCipher(passphrase string, salt []byte) (*dataCipher, error) {
	if strings.TrimSpace(passphrase) == "" {
		return nil, nil
	}
	if len(salt) == 0 {
		return nil, fmt.Errorf("app data encryption salt is missing")
	}

	key := pbkdf2.Key([]byte(passphrase), salt, appDataKeyRounds, 32, sha256.New)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create data cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create data cipher mode: %w", err)
	}

	return &dataCipher{aead: aead}, nil
}

func appDataEncryptionEnabled() bool {
	return !appDataEncryptionDisabled()
}

func appDataEncryptionDisabled() bool {
	switch strings.ToLower(strings.TrimSpace(envconfig.AppDataEncryption())) {
	case "0", "false", "off", "disabled":
		return true
	default:
		return false
	}
}

func IsAppDataEncryptionError(err error) bool {
	return errors.Is(err, ErrAppDataEncryptionKeyMissing) || errors.Is(err, ErrAppDataEncryptionKeyInvalid)
}

func AppDataEncryptionUserMessage(err error) string {
	if errors.Is(err, ErrAppDataEncryptionKeyMissing) {
		return "App data is encrypted. Set OLLAMA_APP_DATA_KEY to the correct key, then restart Ollama."
	}
	if errors.Is(err, ErrAppDataEncryptionKeyInvalid) {
		return "App data is encrypted, but OLLAMA_APP_DATA_KEY did not unlock it. Set the correct key, or start once with OLLAMA_APP_DATA_ENCRYPTION=off and the correct key to decrypt app data."
	}
	return ""
}

func (s *Store) AppDataEncryptionStatus() AppDataEncryptionStatus {
	status := AppDataEncryptionStatus{
		State:         AppDataEncryptionStatePlain,
		KeyConfigured: appDataKeyPassphrase() != "",
		Disabled:      appDataEncryptionDisabled(),
	}

	if s == nil {
		return status
	}

	s.dbMu.Lock()
	db := s.db
	s.dbMu.Unlock()
	if db != nil {
		return inspectAppDataEncryptionStatus(db.conn, db.cipher, status)
	}

	dbPath := s.DBPath
	if dbPath == "" {
		dbPath = defaultDBPath
	}
	if _, err := os.Stat(dbPath); err != nil {
		if os.IsNotExist(err) {
			if status.KeyConfigured && !status.Disabled {
				status.State = AppDataEncryptionStateEnabled
			}
			return status
		}
		status.State = AppDataEncryptionStateUnknown
		status.Error = "Could not inspect app data encryption state."
		return status
	}

	conn, err := sql.Open("sqlite3", dbPath+"?_foreign_keys=on&_query_only=1&_busy_timeout=5000")
	if err != nil {
		status.State = AppDataEncryptionStateUnknown
		status.Error = "Could not inspect app data encryption state."
		return status
	}
	defer conn.Close()

	if err := conn.Ping(); err != nil {
		status.State = AppDataEncryptionStateUnknown
		status.Error = "Could not inspect app data encryption state."
		return status
	}

	return inspectAppDataEncryptionStatus(conn, nil, status)
}

type appDataEncryptionPresence struct {
	marker        sql.NullString
	encryptedRows bool
}

func inspectAppDataEncryptionStatus(conn *sql.DB, cipher *dataCipher, status AppDataEncryptionStatus) AppDataEncryptionStatus {
	presence, err := inspectAppDataEncryptionPresence(conn)
	if err != nil {
		status.State = AppDataEncryptionStateUnknown
		status.Error = "Could not inspect app data encryption state."
		return status
	}
	salt, err := readAppDataEncryptionSalt(conn)
	if err != nil {
		status.State = AppDataEncryptionStateUnknown
		status.Error = "Could not inspect app data encryption state."
		return status
	}

	status.Encrypted = presence.marker.Valid || presence.encryptedRows
	status.Legacy = status.Encrypted && len(salt) == 0
	if !status.Encrypted {
		if status.KeyConfigured && !status.Disabled {
			status.State = AppDataEncryptionStateEnabled
		} else {
			status.State = AppDataEncryptionStatePlain
		}
		return status
	}

	if cipher == nil && status.KeyConfigured {
		if len(salt) > 0 {
			cipher, err = newDataCipherFromEnv(salt)
		} else {
			cipher, err = newLegacyDataCipherFromEnv()
		}
		if err != nil {
			status.State = AppDataEncryptionStateKeyInvalid
			status.Error = AppDataEncryptionUserMessage(ErrAppDataEncryptionKeyInvalid)
			return status
		}
	}

	if cipher == nil {
		status.State = AppDataEncryptionStateKeyMissing
		status.Error = AppDataEncryptionUserMessage(ErrAppDataEncryptionKeyMissing)
		return status
	}

	if err := validateAppDataEncryptionPresence(conn, cipher, presence); err != nil {
		if errors.Is(err, ErrAppDataEncryptionKeyMissing) {
			status.State = AppDataEncryptionStateKeyMissing
			status.Error = AppDataEncryptionUserMessage(ErrAppDataEncryptionKeyMissing)
			return status
		}
		status.State = AppDataEncryptionStateKeyInvalid
		status.Error = AppDataEncryptionUserMessage(ErrAppDataEncryptionKeyInvalid)
		return status
	}

	if status.Legacy {
		status.State = AppDataEncryptionStateLegacy
	} else {
		status.State = AppDataEncryptionStateEncrypted
	}
	return status
}

func readAppDataEncryptionSalt(conn *sql.DB) ([]byte, error) {
	if exists, err := sqliteTableExists(conn, "app_metadata"); err != nil {
		return nil, err
	} else if !exists {
		return nil, nil
	}

	var encoded string
	err := conn.QueryRow(`SELECT value FROM app_metadata WHERE key = ?`, appDataEncryptionSaltKey).Scan(&encoded)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	salt, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("decode app data encryption salt: %w", err)
	}
	if len(salt) == 0 {
		return nil, fmt.Errorf("app data encryption salt is empty")
	}
	return salt, nil
}

func inspectAppDataEncryptionPresence(conn *sql.DB) (appDataEncryptionPresence, error) {
	var presence appDataEncryptionPresence

	if exists, err := sqliteTableExists(conn, "app_metadata"); err != nil {
		return presence, err
	} else if exists {
		err := conn.QueryRow(`SELECT value FROM app_metadata WHERE key = ?`, appDataEncryptionMetadataKey).Scan(&presence.marker)
		if err != nil && err != sql.ErrNoRows {
			return presence, err
		}
	}

	hasRows, err := inspectEncryptedAppDataRows(conn)
	if err != nil {
		return presence, err
	}
	presence.encryptedRows = hasRows
	return presence, nil
}

func inspectEncryptedAppDataRows(conn *sql.DB) (bool, error) {
	for _, column := range sensitiveAppDataTextColumns {
		ok, err := sqliteColumnExists(conn, column.table, column.column)
		if err != nil {
			return false, err
		}
		if !ok {
			continue
		}

		var value int
		err = conn.QueryRow(
			fmt.Sprintf("SELECT 1 FROM %s WHERE %s LIKE ? LIMIT 1", column.table, column.column),
			encryptedTextPrefix+"%",
		).Scan(&value)
		if err == nil {
			return true, nil
		}
		if err != sql.ErrNoRows {
			return false, err
		}
	}

	for _, column := range sensitiveAppDataBlobColumns {
		ok, err := sqliteColumnExists(conn, column.table, column.column)
		if err != nil {
			return false, err
		}
		if !ok {
			continue
		}

		var value int
		err = conn.QueryRow(
			fmt.Sprintf("SELECT 1 FROM %s WHERE substr(%s, 1, ?) = ? LIMIT 1", column.table, column.column),
			len(encryptedBlobPrefix),
			encryptedBlobPrefix,
		).Scan(&value)
		if err == nil {
			return true, nil
		}
		if err != sql.ErrNoRows {
			return false, err
		}
	}

	return false, nil
}

func validateAppDataEncryptionPresence(conn *sql.DB, cipher *dataCipher, presence appDataEncryptionPresence) error {
	db := &database{conn: conn, cipher: cipher}
	if presence.marker.Valid {
		decrypted, err := db.decryptString(presence.marker.String)
		if err != nil {
			return err
		}
		if decrypted != appDataEncryptionSentinelValue {
			return ErrAppDataEncryptionKeyInvalid
		}
	}

	return validateEncryptedAppDataRows(conn, db)
}

func validateEncryptedAppDataRows(conn *sql.DB, db *database) error {
	for _, column := range sensitiveAppDataTextColumns {
		ok, err := sqliteColumnExists(conn, column.table, column.column)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}

		rows, err := conn.Query(
			fmt.Sprintf("SELECT %s FROM %s WHERE %s LIKE ?", column.column, column.table, column.column),
			encryptedTextPrefix+"%",
		)
		if err != nil {
			return err
		}

		for rows.Next() {
			var value string
			if err := rows.Scan(&value); err != nil {
				rows.Close()
				return err
			}
			if _, err := db.decryptString(value); err != nil {
				rows.Close()
				return err
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
	}

	for _, column := range sensitiveAppDataBlobColumns {
		ok, err := sqliteColumnExists(conn, column.table, column.column)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}

		rows, err := conn.Query(
			fmt.Sprintf("SELECT %s FROM %s WHERE substr(%s, 1, ?) = ?", column.column, column.table, column.column),
			len(encryptedBlobPrefix),
			encryptedBlobPrefix,
		)
		if err != nil {
			return err
		}

		for rows.Next() {
			var value []byte
			if err := rows.Scan(&value); err != nil {
				rows.Close()
				return err
			}
			if _, err := db.decryptBytes(value); err != nil {
				rows.Close()
				return err
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
	}

	return nil
}

func sqliteTableExists(conn *sql.DB, table string) (bool, error) {
	var value int
	err := conn.QueryRow(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&value)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func sqliteColumnExists(conn *sql.DB, table, column string) (bool, error) {
	if exists, err := sqliteTableExists(conn, table); err != nil || !exists {
		return false, err
	}

	rows, err := conn.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid       int
			name      string
			fieldType string
			notNull   int
			defaultV  any
			pk        int
		)
		if err := rows.Scan(&cid, &name, &fieldType, &notNull, &defaultV, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	return false, nil
}

func (db *database) configureAppDataEncryption() error {
	passphrase := appDataKeyPassphrase()
	disabled := appDataEncryptionDisabled()

	presence, err := inspectAppDataEncryptionPresence(db.conn)
	if err != nil {
		return fmt.Errorf("inspect app data encryption: %w", err)
	}
	encrypted := presence.marker.Valid || presence.encryptedRows

	salt, err := readAppDataEncryptionSalt(db.conn)
	if err != nil {
		return fmt.Errorf("read app data encryption salt: %w", err)
	}

	legacy := false
	if passphrase != "" {
		switch {
		case len(salt) > 0:
			db.cipher, err = newDataCipher(passphrase, salt)
		case encrypted:
			db.cipher, err = newDataCipher(passphrase, []byte(legacyAppDataKeySalt))
			legacy = true
		case !disabled:
			salt, err = randomAppDataEncryptionSalt()
			if err == nil {
				err = db.setAppDataEncryptionSalt(salt)
			}
			if err == nil {
				db.cipher, err = newDataCipher(passphrase, salt)
			}
		}
		if err != nil {
			return err
		}
	}

	db.encryptAppData = !disabled && db.cipher != nil
	if err := db.reconcileAppDataEncryption(); err != nil {
		return err
	}
	if legacy && db.encryptAppData {
		if err := db.migrateLegacyAppDataEncryptionSalt(); err != nil {
			return err
		}
	}

	return nil
}

func randomAppDataEncryptionSalt() ([]byte, error) {
	salt := make([]byte, appDataSaltBytes)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, fmt.Errorf("create app data encryption salt: %w", err)
	}
	return salt, nil
}

func (db *database) setAppDataEncryptionSalt(salt []byte) error {
	_, err := db.conn.Exec(`
		INSERT INTO app_metadata (key, value)
		VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, appDataEncryptionSaltKey, base64.RawStdEncoding.EncodeToString(salt))
	if err != nil {
		return fmt.Errorf("write app data encryption salt: %w", err)
	}
	return nil
}

func setAppDataEncryptionSaltTx(tx *sql.Tx, salt []byte) error {
	_, err := tx.Exec(`
		INSERT INTO app_metadata (key, value)
		VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, appDataEncryptionSaltKey, base64.RawStdEncoding.EncodeToString(salt))
	if err != nil {
		return fmt.Errorf("write app data encryption salt: %w", err)
	}
	return nil
}

func (db *database) clearAppDataEncryptionSalt() error {
	_, err := db.conn.Exec(`DELETE FROM app_metadata WHERE key = ?`, appDataEncryptionSaltKey)
	if err != nil {
		return fmt.Errorf("clear app data encryption salt: %w", err)
	}
	return nil
}

func (db *database) reconcileAppDataEncryption() error {
	marker, err := db.appDataEncryptionMarker()
	if err != nil {
		return err
	}

	hasEncryptedRows, err := db.hasEncryptedAppDataRows()
	if err != nil {
		return err
	}

	if appDataEncryptionDisabled() {
		if marker.Valid || hasEncryptedRows {
			if err := db.validateEncryptedAppData(marker); err != nil {
				return err
			}
			if err := db.decryptAppDataAtRest(); err != nil {
				return fmt.Errorf("decrypt app data: %w", err)
			}
		}
		if err := db.clearAppDataEncryptionMarker(); err != nil {
			return err
		}
		if err := db.clearAppDataEncryptionSalt(); err != nil {
			return err
		}
		db.encryptAppData = false
		return nil
	}

	if marker.Valid || hasEncryptedRows {
		if err := db.validateEncryptedAppData(marker); err != nil {
			return err
		}
	}
	if db.encryptAppData {
		if err := db.setAppDataEncryptionMarker(); err != nil {
			return err
		}
		if err := db.encryptAppDataAtRest(); err != nil {
			return fmt.Errorf("encrypt app data: %w", err)
		}
	}

	return nil
}

func (db *database) appDataEncryptionMarker() (sql.NullString, error) {
	var marker sql.NullString
	err := db.conn.QueryRow(`SELECT value FROM app_metadata WHERE key = ?`, appDataEncryptionMetadataKey).Scan(&marker)
	if err == sql.ErrNoRows {
		return sql.NullString{}, nil
	}
	if err != nil {
		return sql.NullString{}, fmt.Errorf("read app data encryption marker: %w", err)
	}
	return marker, nil
}

func (db *database) setAppDataEncryptionMarker() error {
	marker, err := db.encryptString(appDataEncryptionSentinelValue)
	if err != nil {
		return fmt.Errorf("encrypt app data marker: %w", err)
	}
	if marker == appDataEncryptionSentinelValue {
		return ErrAppDataEncryptionKeyMissing
	}

	_, err = db.conn.Exec(`
		INSERT INTO app_metadata (key, value)
		VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, appDataEncryptionMetadataKey, marker)
	if err != nil {
		return fmt.Errorf("write app data encryption marker: %w", err)
	}
	return nil
}

func (db *database) setAppDataEncryptionMarkerTx(tx *sql.Tx) error {
	marker, err := db.encryptString(appDataEncryptionSentinelValue)
	if err != nil {
		return fmt.Errorf("encrypt app data marker: %w", err)
	}
	if marker == appDataEncryptionSentinelValue {
		return ErrAppDataEncryptionKeyMissing
	}

	_, err = tx.Exec(`
		INSERT INTO app_metadata (key, value)
		VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, appDataEncryptionMetadataKey, marker)
	if err != nil {
		return fmt.Errorf("write app data encryption marker: %w", err)
	}
	return nil
}

func (db *database) clearAppDataEncryptionMarker() error {
	_, err := db.conn.Exec(`DELETE FROM app_metadata WHERE key = ?`, appDataEncryptionMetadataKey)
	if err != nil {
		return fmt.Errorf("clear app data encryption marker: %w", err)
	}
	return nil
}

func (db *database) validateEncryptedAppData(marker sql.NullString) error {
	if marker.Valid {
		decrypted, err := db.decryptString(marker.String)
		if err != nil {
			return err
		}
		if decrypted != appDataEncryptionSentinelValue {
			return ErrAppDataEncryptionKeyInvalid
		}
	}

	return db.validateEncryptedAppDataRows()
}

func (db *database) encryptString(value string) (string, error) {
	if !db.encryptAppData || db.cipher == nil || value == "" {
		return value, nil
	}

	nonce := make([]byte, db.cipher.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("create encryption nonce: %w", err)
	}

	sealed := db.cipher.aead.Seal(nonce, nonce, []byte(value), nil)
	return encryptedTextPrefix + base64.RawStdEncoding.EncodeToString(sealed), nil
}

func (db *database) decryptString(value string) (string, error) {
	if value == "" || !strings.HasPrefix(value, encryptedTextPrefix) {
		return value, nil
	}
	if db.cipher == nil {
		return "", ErrAppDataEncryptionKeyMissing
	}

	encoded := strings.TrimPrefix(value, encryptedTextPrefix)
	sealed, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("decode encrypted app data: %w", err)
	}
	if len(sealed) < db.cipher.aead.NonceSize() {
		return "", fmt.Errorf("encrypted app data is truncated")
	}

	nonce := sealed[:db.cipher.aead.NonceSize()]
	ciphertext := sealed[db.cipher.aead.NonceSize():]
	plaintext, err := db.cipher.aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", ErrAppDataEncryptionKeyInvalid
	}

	return string(plaintext), nil
}

func (db *database) encryptNullString(value sql.NullString) (sql.NullString, error) {
	if !value.Valid || value.String == "" {
		return value, nil
	}

	encrypted, err := db.encryptString(value.String)
	if err != nil {
		return sql.NullString{}, err
	}
	return sql.NullString{String: encrypted, Valid: true}, nil
}

func (db *database) decryptNullString(value sql.NullString) (sql.NullString, error) {
	if !value.Valid || value.String == "" {
		return value, nil
	}

	decrypted, err := db.decryptString(value.String)
	if err != nil {
		return sql.NullString{}, err
	}
	return sql.NullString{String: decrypted, Valid: true}, nil
}

func (db *database) encryptBytes(value []byte) ([]byte, error) {
	if !db.encryptAppData || db.cipher == nil || len(value) == 0 {
		return value, nil
	}

	nonce := make([]byte, db.cipher.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("create encryption nonce: %w", err)
	}

	sealed := db.cipher.aead.Seal(nonce, nonce, value, nil)
	out := make([]byte, 0, len(encryptedBlobPrefix)+len(sealed))
	out = append(out, encryptedBlobPrefix...)
	out = append(out, sealed...)
	return out, nil
}

func (db *database) decryptBytes(value []byte) ([]byte, error) {
	if len(value) == 0 || !bytes.HasPrefix(value, encryptedBlobPrefix) {
		return value, nil
	}
	if db.cipher == nil {
		return nil, ErrAppDataEncryptionKeyMissing
	}

	sealed := value[len(encryptedBlobPrefix):]
	if len(sealed) < db.cipher.aead.NonceSize() {
		return nil, fmt.Errorf("encrypted app data is truncated")
	}

	nonce := sealed[:db.cipher.aead.NonceSize()]
	ciphertext := sealed[db.cipher.aead.NonceSize():]
	plaintext, err := db.cipher.aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, ErrAppDataEncryptionKeyInvalid
	}

	return plaintext, nil
}

func (db *database) hasEncryptedAppDataRows() (bool, error) {
	for _, column := range sensitiveAppDataTextColumns {
		var value string
		err := db.conn.QueryRow(
			fmt.Sprintf("SELECT %s FROM %s WHERE %s LIKE ? LIMIT 1", column.column, column.table, column.column),
			encryptedTextPrefix+"%",
		).Scan(&value)
		if err == nil {
			return true, nil
		}
		if err != sql.ErrNoRows {
			return false, fmt.Errorf("check encrypted %s.%s: %w", column.table, column.column, err)
		}
	}

	for _, column := range sensitiveAppDataBlobColumns {
		var value []byte
		err := db.conn.QueryRow(
			fmt.Sprintf("SELECT %s FROM %s WHERE substr(%s, 1, ?) = ? LIMIT 1", column.column, column.table, column.column),
			len(encryptedBlobPrefix),
			encryptedBlobPrefix,
		).Scan(&value)
		if err == nil {
			return true, nil
		}
		if err != sql.ErrNoRows {
			return false, fmt.Errorf("check encrypted %s.%s: %w", column.table, column.column, err)
		}
	}

	return false, nil
}

func (db *database) validateEncryptedAppDataRows() error {
	for _, column := range sensitiveAppDataTextColumns {
		rows, err := db.conn.Query(
			fmt.Sprintf("SELECT %s FROM %s WHERE %s LIKE ?", column.column, column.table, column.column),
			encryptedTextPrefix+"%",
		)
		if err != nil {
			return fmt.Errorf("query encrypted %s.%s: %w", column.table, column.column, err)
		}

		for rows.Next() {
			var value string
			if err := rows.Scan(&value); err != nil {
				rows.Close()
				return fmt.Errorf("scan encrypted %s.%s: %w", column.table, column.column, err)
			}
			if _, err := db.decryptString(value); err != nil {
				rows.Close()
				return fmt.Errorf("decrypt %s.%s: %w", column.table, column.column, err)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("iterate encrypted %s.%s: %w", column.table, column.column, err)
		}
		rows.Close()
	}

	for _, column := range sensitiveAppDataBlobColumns {
		rows, err := db.conn.Query(
			fmt.Sprintf("SELECT %s FROM %s WHERE substr(%s, 1, ?) = ?", column.column, column.table, column.column),
			len(encryptedBlobPrefix),
			encryptedBlobPrefix,
		)
		if err != nil {
			return fmt.Errorf("query encrypted %s.%s: %w", column.table, column.column, err)
		}

		for rows.Next() {
			var value []byte
			if err := rows.Scan(&value); err != nil {
				rows.Close()
				return fmt.Errorf("scan encrypted %s.%s: %w", column.table, column.column, err)
			}
			if _, err := db.decryptBytes(value); err != nil {
				rows.Close()
				return fmt.Errorf("decrypt %s.%s: %w", column.table, column.column, err)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("iterate encrypted %s.%s: %w", column.table, column.column, err)
		}
		rows.Close()
	}

	return nil
}

func (db *database) decryptAppDataAtRest() error {
	tx, err := db.conn.Begin()
	if err != nil {
		return fmt.Errorf("begin decrypt transaction: %w", err)
	}
	defer tx.Rollback()

	for _, column := range sensitiveAppDataTextColumns {
		if err := db.decryptTextColumn(tx, column.table, column.idColumn, column.column); err != nil {
			return err
		}
	}
	for _, column := range sensitiveAppDataBlobColumns {
		if err := db.decryptBlobColumn(tx, column.table, column.idColumn, column.column); err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit decrypt transaction: %w", err)
	}
	return nil
}

func (db *database) encryptAppDataAtRest() error {
	if !db.encryptAppData || db.cipher == nil {
		return nil
	}

	tx, err := db.conn.Begin()
	if err != nil {
		return fmt.Errorf("begin encrypt transaction: %w", err)
	}
	defer tx.Rollback()

	for _, column := range sensitiveAppDataTextColumns {
		if err := db.encryptTextColumn(tx, column.table, column.idColumn, column.column); err != nil {
			return err
		}
	}
	for _, column := range sensitiveAppDataBlobColumns {
		if err := db.encryptBlobColumn(tx, column.table, column.idColumn, column.column); err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit encrypt transaction: %w", err)
	}
	return nil
}

func (db *database) migrateLegacyAppDataEncryptionSalt() error {
	newSalt, err := randomAppDataEncryptionSalt()
	if err != nil {
		return err
	}
	newCipher, err := newDataCipher(appDataKeyPassphrase(), newSalt)
	if err != nil {
		return err
	}

	oldCipher := db.cipher
	oldEncryptAppData := db.encryptAppData
	tx, err := db.conn.Begin()
	if err != nil {
		return fmt.Errorf("begin app data encryption migration: %w", err)
	}
	defer func() {
		if err != nil {
			db.cipher = oldCipher
			db.encryptAppData = oldEncryptAppData
		}
		_ = tx.Rollback()
	}()

	for _, column := range sensitiveAppDataTextColumns {
		if err = db.decryptTextColumn(tx, column.table, column.idColumn, column.column); err != nil {
			return err
		}
	}
	for _, column := range sensitiveAppDataBlobColumns {
		if err = db.decryptBlobColumn(tx, column.table, column.idColumn, column.column); err != nil {
			return err
		}
	}

	db.cipher = newCipher
	db.encryptAppData = true
	for _, column := range sensitiveAppDataTextColumns {
		if err = db.encryptTextColumn(tx, column.table, column.idColumn, column.column); err != nil {
			return err
		}
	}
	for _, column := range sensitiveAppDataBlobColumns {
		if err = db.encryptBlobColumn(tx, column.table, column.idColumn, column.column); err != nil {
			return err
		}
	}
	if err = setAppDataEncryptionSaltTx(tx, newSalt); err != nil {
		return err
	}
	if err = db.setAppDataEncryptionMarkerTx(tx); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit app data encryption migration: %w", err)
	}
	err = nil
	return nil
}

func (db *database) encryptTextColumn(tx *sql.Tx, table, idColumn, column string) error {
	rows, err := tx.Query(fmt.Sprintf("SELECT %s, %s FROM %s", idColumn, column, table))
	if err != nil {
		return fmt.Errorf("query plaintext %s.%s: %w", table, column, err)
	}

	type update struct {
		id    any
		value sql.NullString
	}
	var updates []update
	for rows.Next() {
		var id any
		var value sql.NullString
		if err := rows.Scan(&id, &value); err != nil {
			rows.Close()
			return fmt.Errorf("scan plaintext %s.%s: %w", table, column, err)
		}
		if !value.Valid || value.String == "" || strings.HasPrefix(value.String, encryptedTextPrefix) {
			continue
		}

		encrypted, err := db.encryptString(value.String)
		if err != nil {
			rows.Close()
			return fmt.Errorf("encrypt %s.%s: %w", table, column, err)
		}
		if encrypted != value.String {
			updates = append(updates, update{
				id:    id,
				value: sql.NullString{String: encrypted, Valid: true},
			})
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate plaintext %s.%s: %w", table, column, err)
	}
	rows.Close()

	for _, update := range updates {
		if _, err := tx.Exec(
			fmt.Sprintf("UPDATE %s SET %s = ? WHERE %s = ?", table, column, idColumn),
			update.value,
			update.id,
		); err != nil {
			return fmt.Errorf("rewrite encrypted %s.%s: %w", table, column, err)
		}
	}

	return nil
}

func (db *database) encryptBlobColumn(tx *sql.Tx, table, idColumn, column string) error {
	rows, err := tx.Query(fmt.Sprintf("SELECT %s, %s FROM %s", idColumn, column, table))
	if err != nil {
		return fmt.Errorf("query plaintext %s.%s: %w", table, column, err)
	}

	type update struct {
		id    any
		value []byte
	}
	var updates []update
	for rows.Next() {
		var id any
		var value []byte
		if err := rows.Scan(&id, &value); err != nil {
			rows.Close()
			return fmt.Errorf("scan plaintext %s.%s: %w", table, column, err)
		}
		if len(value) == 0 || bytes.HasPrefix(value, encryptedBlobPrefix) {
			continue
		}

		encrypted, err := db.encryptBytes(value)
		if err != nil {
			rows.Close()
			return fmt.Errorf("encrypt %s.%s: %w", table, column, err)
		}
		if !bytes.Equal(encrypted, value) {
			updates = append(updates, update{id: id, value: encrypted})
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate plaintext %s.%s: %w", table, column, err)
	}
	rows.Close()

	for _, update := range updates {
		if _, err := tx.Exec(
			fmt.Sprintf("UPDATE %s SET %s = ? WHERE %s = ?", table, column, idColumn),
			update.value,
			update.id,
		); err != nil {
			return fmt.Errorf("rewrite encrypted %s.%s: %w", table, column, err)
		}
	}

	return nil
}

func (db *database) decryptTextColumn(tx *sql.Tx, table, idColumn, column string) error {
	rows, err := tx.Query(fmt.Sprintf("SELECT %s, %s FROM %s", idColumn, column, table))
	if err != nil {
		return fmt.Errorf("query encrypted %s.%s: %w", table, column, err)
	}

	type update struct {
		id    any
		value sql.NullString
	}
	var updates []update
	for rows.Next() {
		var id any
		var value sql.NullString
		if err := rows.Scan(&id, &value); err != nil {
			rows.Close()
			return fmt.Errorf("scan encrypted %s.%s: %w", table, column, err)
		}
		if !value.Valid {
			continue
		}

		decrypted, err := db.decryptString(value.String)
		if err != nil {
			rows.Close()
			return fmt.Errorf("decrypt %s.%s: %w", table, column, err)
		}
		if decrypted != value.String {
			updates = append(updates, update{
				id:    id,
				value: sql.NullString{String: decrypted, Valid: true},
			})
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate encrypted %s.%s: %w", table, column, err)
	}
	rows.Close()

	for _, update := range updates {
		if _, err := tx.Exec(
			fmt.Sprintf("UPDATE %s SET %s = ? WHERE %s = ?", table, column, idColumn),
			update.value,
			update.id,
		); err != nil {
			return fmt.Errorf("rewrite decrypted %s.%s: %w", table, column, err)
		}
	}

	return nil
}

func (db *database) decryptBlobColumn(tx *sql.Tx, table, idColumn, column string) error {
	rows, err := tx.Query(fmt.Sprintf("SELECT %s, %s FROM %s", idColumn, column, table))
	if err != nil {
		return fmt.Errorf("query encrypted %s.%s: %w", table, column, err)
	}

	type update struct {
		id    any
		value []byte
	}
	var updates []update
	for rows.Next() {
		var id any
		var value []byte
		if err := rows.Scan(&id, &value); err != nil {
			rows.Close()
			return fmt.Errorf("scan encrypted %s.%s: %w", table, column, err)
		}

		decrypted, err := db.decryptBytes(value)
		if err != nil {
			rows.Close()
			return fmt.Errorf("decrypt %s.%s: %w", table, column, err)
		}
		if !bytes.Equal(decrypted, value) {
			updates = append(updates, update{id: id, value: decrypted})
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate encrypted %s.%s: %w", table, column, err)
	}
	rows.Close()

	for _, update := range updates {
		if _, err := tx.Exec(
			fmt.Sprintf("UPDATE %s SET %s = ? WHERE %s = ?", table, column, idColumn),
			update.value,
			update.id,
		); err != nil {
			return fmt.Errorf("rewrite decrypted %s.%s: %w", table, column, err)
		}
	}

	return nil
}
