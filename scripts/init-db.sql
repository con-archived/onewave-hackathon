-- db.md 스키마: 로컬 Postgres 초기화 (idempotent)

-- 1. Users & Settings
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email TEXT,
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_users_provider_provider_user_id ON users (provider, provider_user_id);

CREATE TABLE IF NOT EXISTS user_vocabulary_settings (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    language TEXT NOT NULL DEFAULT 'en',
    level TEXT NOT NULL DEFAULT 'intermediate',
    max_words INT NOT NULL DEFAULT 30,
    min_length INT NOT NULL DEFAULT 2
);

-- 2. Music History (YouTube Capture)
CREATE TABLE IF NOT EXISTS user_music_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    video_id TEXT NOT NULL,
    title TEXT,
    capture_time INT,
    origin TEXT DEFAULT 'YouTube',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_music_history_user_id ON user_music_history (user_id);

-- 3. Words & Synonyms
CREATE TABLE IF NOT EXISTS user_words (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    word TEXT NOT NULL,
    meaning TEXT,
    count INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, word)
);
CREATE INDEX IF NOT EXISTS idx_user_words_user_id ON user_words (user_id);
-- Migration: add count and unique for existing DBs
ALTER TABLE user_words ADD COLUMN IF NOT EXISTS count INT NOT NULL DEFAULT 1;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_words_user_id_word_key') THEN
        ALTER TABLE user_words ADD CONSTRAINT user_words_user_id_word_key UNIQUE (user_id, word);
    END IF;
EXCEPTION
    WHEN unique_violation THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS word_synonyms (
    id SERIAL PRIMARY KEY,
    user_word_id UUID NOT NULL REFERENCES user_words (id) ON DELETE CASCADE,
    synonym TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_word_synonyms_user_word_id ON word_synonyms (user_word_id);
-- (user_word_id, synonym) 중복 방지. 기존 테이블에는 제약 추가만 시도(이미 있거나 중복 행 있으면 스킵).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid = 'word_synonyms'::regclass AND conname = 'word_synonyms_user_word_id_synonym_key'
    ) THEN
        ALTER TABLE word_synonyms ADD CONSTRAINT word_synonyms_user_word_id_synonym_key UNIQUE (user_word_id, synonym);
    END IF;
EXCEPTION
    WHEN unique_violation THEN NULL;
END $$;

-- 4. Vocabulary Lists (Group / Legacy)
CREATE TABLE IF NOT EXISTS vocabulary_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title TEXT,
    entries JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vocabulary_lists_user_id ON vocabulary_lists (user_id);
CREATE INDEX IF NOT EXISTS idx_vocabulary_lists_created_at ON vocabulary_lists (user_id, created_at DESC);
