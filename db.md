# DB 설계 (Hyperdrive + PostgreSQL)

- **연결**: Cloudflare Hyperdrive로 PostgreSQL 연결 (Worker에서 바인딩 사용).
- **인증**: 추후 OAuth 2.0으로 사용자 생성·인증 예정. 테이블은 `user_id` 기준으로 설계.

---

## 테이블 목록

| 테이블                     | 설명                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `users`                    | OAuth 2.0 사용자 (provider, provider_user_id, email, display_name)  |
| `user_vocabulary_settings` | 사용자별 AI 단어 생성 취향 (language, level, max_words, min_length) |
| `user_words`               | 사용자별 단어 모음집 (word, meaning)                                |
| `word_synonyms`            | 단어별 유의어 (user_word_id, synonym)                               |
| `user_music_history`       | 시청 히스토리 (video_id, title, capture_time, origin)               |
| `vocabulary_lists`         | 단어장 그룹/레거시 (title, entries JSONB 캐시)                      |

테이블 관계도는 [db-schema.md](./db-schema.md) 참고.

---

## 1. 사용자 및 설정 (Core)

### users

| 컬럼               | 타입        | 제약                          | 설명                |
| ------------------ | ----------- | ----------------------------- | ------------------- |
| `id`               | UUID        | PK, DEFAULT gen_random_uuid() | 내부 사용자 고유 ID |
| `provider`         | TEXT        | NOT NULL                      | OAuth 제공자        |
| `provider_user_id` | TEXT        | NOT NULL                      | 제공자 측 고유 ID   |
| `email`            | TEXT        |                               | 이메일 주소         |
| `display_name`     | TEXT        |                               | 사용자 이름         |
| `created_at`       | TIMESTAMPTZ | DEFAULT now()                 | 생성 시각           |

- **UNIQUE(provider, provider_user_id)** 로 동일 OAuth 계정 중복 방지.

### user_vocabulary_settings

| 컬럼         | 타입 | 제약              | 설명                                      |
| ------------ | ---- | ----------------- | ----------------------------------------- |
| `user_id`    | UUID | PK, FK (users.id) | 사용자 ID (1:1)                           |
| `language`   | TEXT | NOT NULL          | 학습 언어 (en, ko)                        |
| `level`      | TEXT | NOT NULL          | 난이도 (beginner, intermediate, advanced) |
| `max_words`  | INT  | DEFAULT 30        | 생성할 최대 단어 수                       |
| `min_length` | INT  | DEFAULT 2         | 제외할 최소 글자 수                       |

- 사용자당 1행. 조회 시 없으면 앱 기본값 사용.

---

## 2. 단어 및 유의어 (Vocabulary Entity)

구조: users → user_words → word_synonyms

### user_words

| 컬럼         | 타입        | 제약                          | 설명                     |
| ------------ | ----------- | ----------------------------- | ------------------------ |
| `id`         | UUID        | PK, DEFAULT gen_random_uuid() | 단어 엔티티 고유 ID      |
| `user_id`    | UUID        | NOT NULL, FK (users.id)       | 소유자 ID                |
| `word`       | TEXT        | NOT NULL                      | 저장된 단어 원문         |
| `meaning`    | TEXT        |                               | 뜻/해석 (Gemini 생성본)  |
| `count`      | INT         | NOT NULL DEFAULT 1            | 등장 횟수 (중복 시 증가) |
| `created_at` | TIMESTAMPTZ | DEFAULT now()                 | 저장 일시                |

- **UNIQUE(user_id, word)** 로 사용자별 동일 단어 1행. 단어장 저장 시 이미 있으면 `count`만 증가.

### word_synonyms

| 컬럼           | 타입   | 제약                         | 설명         |
| -------------- | ------ | ---------------------------- | ------------ |
| `id`           | SERIAL | PK                           | 유의어 ID    |
| `user_word_id` | UUID   | NOT NULL, FK (user_words.id) | 부모 단어 ID |
| `synonym`      | TEXT   | NOT NULL                     | 유의어 단어  |

---

## 3. 음악 정보 및 캡처 (Music History)

### user_music_history

| 컬럼           | 타입        | 제약                          | 설명              |
| -------------- | ----------- | ----------------------------- | ----------------- |
| `id`           | UUID        | PK, DEFAULT gen_random_uuid() | 히스토리 고유 ID  |
| `user_id`      | UUID        | NOT NULL, FK (users.id)       | 시청한 사용자     |
| `video_id`     | TEXT        | NOT NULL                      | YouTube 비디오 ID |
| `title`        | TEXT        |                               | 곡/영상 제목      |
| `capture_time` | INT         |                               | 캡처 시점 (초)    |
| `origin`       | TEXT        | DEFAULT 'YouTube'             | 플랫폼 출처       |
| `created_at`   | TIMESTAMPTZ | DEFAULT now()                 | 시청/기록 시각    |

---

## 4. 기존 단어장 그룹 (Legacy/Grouping)

### vocabulary_lists

여러 단어를 하나의 리스트로 묶어 관리. `entries`는 빠른 조회용 JSONB 캐시.

| 컬럼         | 타입        | 제약          | 설명                  |
| ------------ | ----------- | ------------- | --------------------- |
| `id`         | UUID        | PK            | 리스트 ID             |
| `user_id`    | UUID        | FK (users.id) | 소유자                |
| `title`      | TEXT        |               | 리스트 제목 (곡명 등) |
| `entries`    | JSONB       | NOT NULL      | 단어 목록 스냅샷      |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | 생성 시각             |

- `entries` 예: `[{"word":"shine","score":8,"meaning":"빛나다","example":"shine bright"}, ...]`

---

## 사용 흐름 요약

1. **OAuth 로그인** → `users`에 upsert (provider + provider_user_id 기준).
2. **단어장 생성 요청** → `user_vocabulary_settings` 조회 → 없으면 기본값으로 `createVocabularyFromLyrics(lyrics, options, env)` 호출.
3. **(선택) 단어장 저장** → `vocabulary_lists`에 insert (user_id, title, entries).
4. **(추가) 단어/유의어** → `user_words`, `word_synonyms` 활용 시 별도 로직.
5. **(추가) 음악 히스토리** → `user_music_history`에 video_id, title, capture_time 등 저장.

---

## 로컬 Postgres 연결 (지금)

- **Node에서 직접 연결**: `pg` + `src/db/connect.ts` 사용.
- **설정**: `.env`에 `DATABASE_URL=postgresql://onewave:onewave@localhost:5432/onewave` 설정.

### 로컬 DB 띄우기 (Docker)

```bash
npm run db:up      # Postgres 컨테이너 시작 (onewave-db)
npm run db:init    # 스키마 적용 (scripts/init-db.sql)
npm run db:check   # 연결 확인 (SELECT 1)
```

- **API 서버 (Node)**: `npm run dev:node` → `GET /db/health`로 DB 연결 여부 확인.
- **QueryRunner**: `createPool(DATABASE_URL)` → `createQueryRunner(pool)`로 `settings.ts`의 `getVocabularySettings`, `saveVocabularyList`에 주입.

## Hyperdrive 연결 (나중에 배포)

- Wrangler에 Hyperdrive 바인딩 추가 후, Worker `env`에서 연결 정보 사용. 동일한 `QueryRunner` 시그니처로 `runQuery` 구현해 주입하면 기존 코드 그대로 사용 가능.

---

## vocabulary.ts와 연동

- **옵션 조회**: `getVocabularySettings(userId, runQuery)`로 `user_vocabulary_settings` 한 행 조회.
- **단어장 생성**: `createVocabularyFromLyricsForUser(lyrics, userId, env, meta?)` 사용. `env.saveVocabularyList`가 있으면 생성된 단어장을 `vocabulary_lists`에 저장.
- **env 주입 예**: `createGetVocabularySettings(runQuery)`, `createSaveVocabularyList(runQuery)` 생성 후 라우트에서 `env`에 붙여 사용. 저장 시 메타는 `meta?: { title? }` 로 전달.
