-- D1 Schema for onewave-hackathon

-- 1. Users & Settings
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email TEXT,
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_provider_user_id ON users (provider, provider_user_id);

CREATE TABLE IF NOT EXISTS user_vocabulary_settings (
    user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    language TEXT NOT NULL DEFAULT 'en',
    level TEXT NOT NULL DEFAULT 'intermediate',
    max_words INTEGER NOT NULL DEFAULT 30,
    min_length INTEGER NOT NULL DEFAULT 2
);

-- 2. Music History
CREATE TABLE IF NOT EXISTS user_music_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    video_id TEXT NOT NULL,
    title TEXT,
    capture_time INTEGER,
    origin TEXT DEFAULT 'YouTube',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_music_history_user_id ON user_music_history(user_id);

-- 3. Words & Synonyms
CREATE TABLE IF NOT EXISTS user_words (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    word TEXT NOT NULL,
    meaning TEXT,
    count INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, word)
);
CREATE INDEX IF NOT EXISTS idx_user_words_user_id ON user_words(user_id);

CREATE TABLE IF NOT EXISTS word_synonyms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_word_id TEXT NOT NULL REFERENCES user_words(id) ON DELETE CASCADE,
    synonym TEXT NOT NULL,
    UNIQUE (user_word_id, synonym)
);
CREATE INDEX IF NOT EXISTS idx_word_synonyms_user_word_id ON word_synonyms(user_word_id);

-- 4. Vocabulary Lists
CREATE TABLE IF NOT EXISTS vocabulary_lists (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title TEXT,
    entries TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vocabulary_lists_user_id ON vocabulary_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_vocabulary_lists_created_at ON vocabulary_lists(user_id, created_at DESC);
