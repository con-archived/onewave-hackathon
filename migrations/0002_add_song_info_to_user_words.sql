-- Add song_title and song_artist columns to user_words
-- Tracks which song each word was extracted from

ALTER TABLE user_words ADD COLUMN song_title TEXT;
ALTER TABLE user_words ADD COLUMN song_artist TEXT;
