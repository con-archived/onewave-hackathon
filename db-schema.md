# DB 테이블 구조 모식도

`db.md` 스키마를 기준으로 한 테이블 관계도.

```
                              ┌──────────────────────────────────────────────────┐
                              │ users (PK: id)                                    │
                              │ id, provider, provider_user_id, email,           │
                              │ display_name, created_at                          │
                              │ UNIQUE(provider, provider_user_id)                │
                              └──────────────────────────────────────────────────┘
                                                    │
     ┌──────────────────┬──────────────────┬───────┴───────┬──────────────────┐
     │ 1:1               │ 1:N              │ 1:N           │ 1:N              │
     ▼                   ▼                  ▼               ▼                  │
┌──────────────┐  ┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐
│user_vocab    │  │user_music_history│  │ user_words   │  │vocabulary_lists  │
│_settings     │  │ PK: id           │  │ PK: id       │  │ PK: id           │
│ PK: user_id  │  │ user_id → users  │  │ user_id →   │  │ user_id → users  │
│ → users.id   │  │ video_id, title,  │  │   users.id  │  │ title, entries   │
│ language,    │  │ capture_time,    │  │ word,        │  │   (JSONB),       │
│ level,       │  │ origin, created  │  │ meaning,    │  │ created_at       │
│ max_words,   │  └──────────────────┘  │ created_at  │  └──────────────────┘
│ min_length   │                        └──────┬───────┘
└──────────────┘                               │ 1:N
                                               ▼
                                        ┌──────────────────┐
                                        │ word_synonyms     │
                                        │ PK: id (SERIAL)   │
                                        │ user_word_id →    │
                                        │   user_words.id   │
                                        │ synonym           │
                                        └──────────────────┘
```

- **users**: OAuth 사용자. 다른 테이블은 모두 `user_id`로 여기를 참조.
- **user_vocabulary_settings**: 사용자당 1행. 단어장 생성 옵션(언어·난이도·최대 단어 수 등).
- **user_music_history**: 시청 히스토리(YouTube video_id, title, capture_time 등).
- **user_words** → **word_synonyms**: 단어 원문 + 유의어(1:N). `user_words`에는 `count` 컬럼·UNIQUE(user_id, word) 있어 중복 저장 시 count 증가.
- **vocabulary_lists**: AI로 만든 단어장 스냅샷(title, entries JSONB). 생성·저장 플로우에서 사용.

상세 컬럼·제약은 [db.md](./db.md) 참고.
