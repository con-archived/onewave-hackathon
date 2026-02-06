# 🎵 Onewave 프로젝트 API 명세서 (v1.0)

DB 스키마([db.md](./db.md), [db-schema.md](./db-schema.md)) 및 백엔드 구현(vocabulary, connect, settings)을 반영한 최종 API 상세 명세입니다. OAuth2(Google) + JWT 인증·음악 히스토리·단어장 관리 로직을 통합했으며, 프론트/백엔드 공유용으로 바로 개발에 활용할 수 있습니다.

---

## 0. 공통 가이드라인

| 항목            | 내용                                                            |
| --------------- | --------------------------------------------------------------- |
| **Base URL**    | `https://api.onewave.com/v1` (로컬: `http://localhost:5174/v1`) |
| **인증**        | 로그인 후 서버가 발급한 JWT를 모든 인증 필요 요청 Header에 포함 |
| **Header**      | `Authorization: Bearer <jwt>`                                   |
| **데이터 형식** | 요청/응답 모두 JSON (`Content-Type: application/json`)          |

### 공통 응답 형식

- **성공**: `{ "success": true, "data": { ... } }`
- **실패**: `{ "success": false, "error": { "code": "...", "message": "..." } }`
    - HTTP 상태 코드: 400(잘못된 요청), 401(미인증), 403(권한 없음), 404(없음), 500(서버 오류)

### 백엔드 연동 참고

- **인증**: Google OAuth2 로그인 → `GET /v1/auth/google/callback`에서 code 교환 후 우리 DB `users` 동기화, JWT 발급(payload.sub = users.id). 이후 API는 `Authorization: Bearer <jwt>`로 검증.
- **DB**: `src/db/connect.ts`(Pool, QueryRunner) + `src/db/settings.ts`(getVocabularySettings, saveVocabularyList 등). 로컬은 `DATABASE_URL` + Node 서버(`npm run dev:node`).

---

## 1. OAuth2 로그인 및 JWT 발급

Google 로그인 후 서비스 DB와 유저를 동기화하고 JWT를 발급합니다.

### 1-1. [GET] 로그인 시작 (Google 리다이렉트)

| 항목         | 내용                                                  |
| ------------ | ----------------------------------------------------- |
| **Endpoint** | `GET /auth/google`                                    |
| **설명**     | Google 로그인 페이지로 리다이렉트. 브라우저에서 접근. |

- **동작**: 302 리다이렉트 → `https://accounts.google.com/o/oauth2/v2/auth?...`

### 1-2. [GET] 로그인 콜백 (code → JWT)

| 항목         | 내용                                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| **Endpoint** | `GET /auth/google/callback?code=...`                                           |
| **설명**     | Google이 code를 쿼리로 보냄. code 교환 → userinfo 조회 → DB 동기화 → JWT 발급. |

### Output (Success 200)

```json
{
    "success": true,
    "data": {
        "token": "eyJhbGc...",
        "internal_id": "uuid-...",
        "is_new_user": true
    }
}
```

- `token`: JWT. 이후 API 호출 시 `Authorization: Bearer <token>` 에 넣어 사용.
- `internal_id`: 우리 DB `users.id` (UUID). JWT payload.sub와 동일.
- `is_new_user`: 이번 로그인에서 새로 생성된 유저면 `true`.

- **DB 연동**: `users`에 provider=`google`, provider_user_id=Google 사용자 ID로 upsert. `user_vocabulary_settings` 기본값 생성(없을 때만).
- **SPA 연동**: 백엔드에 `FRONTEND_REDIRECT_URI`(예: `http://localhost:5173/auth/callback`)를 설정하면, 성공 시 해당 URL로 리다이렉트하며 hash에 `#token=...&internal_id=...&is_new_user=...`를 붙입니다. 프론트는 해당 라우트에서 token을 읽어 저장하면 됩니다.

---

## 2. [POST] 음악 메타데이터 저장 (History)

사용자가 시청한 음악 정보를 `user_music_history`에 기록합니다.

| 항목                  | 내용                  |
| --------------------- | --------------------- |
| **Endpoint**          | `POST /music/history` |
| **Input (JSON Body)** | 아래 표 참고          |

| 필드명       | 타입   | 필수 | 설명                         |
| ------------ | ------ | :--: | ---------------------------- |
| video_id     | string |  O   | YouTube 비디오 고유 ID       |
| title        | string |  O   | 곡/영상 제목                 |
| capture_time | number |  X   | 캡처 시점(초)                |
| origin       | string |  X   | 플랫폼 (기본값: `"YouTube"`) |

### Output (Success 201)

```json
{
    "success": true,
    "data": {
        "id": "uuid-...",
        "created_at": "2026-02-07T12:00:00.000Z"
    }
}
```

- **DB**: `user_music_history`에 `user_id`, `video_id`, `title`, `capture_time`, `origin` insert.

---

## 3. [GET] 개별 데이터 조회 API

### 3-1. 유저 프로필 및 설정 조회

| 항목         | 내용                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| **Endpoint** | `GET /user/profile`                                                           |
| **Return**   | `users` 1행 + `user_vocabulary_settings` 1행 (없으면 설정은 기본값 또는 null) |

**Output (200)**

```json
{
    "success": true,
    "data": {
        "id": "uuid-...",
        "display_name": "이찬유",
        "email": "user@example.com",
        "settings": {
            "language": "en",
            "level": "intermediate",
            "max_words": 30,
            "min_length": 2
        }
    }
}
```

- `settings`: `user_vocabulary_settings`의 language, level, max_words, min_length. 없으면 앱 기본값으로 채우거나 null.

---

### 3-2. 단어장 목록 조회

| 항목         | 내용                                                                   |
| ------------ | ---------------------------------------------------------------------- |
| **Endpoint** | `GET /vocabulary/lists`                                                |
| **Return**   | `vocabulary_lists` 전체 목록 (해당 user_id, JSONB `entries` 포함 가능) |

**Output (200)**

```json
{
    "success": true,
    "data": [
        {
            "id": "uuid-...",
            "title": "OMG - NewJeans",
            "entries": [
                { "word": "shine", "score": 8, "meaning": "빛나다", "example": "shine bright" }
            ],
            "created_at": "2026-02-07T12:00:00.000Z"
        }
    ]
}
```

- `entries`: db.md 기준 JSONB 스냅샷. 항목 형식은 vocabulary.ts의 `VocabularyEntry`(word, score?, meaning?, example?, occurrences?).

---

### 3-3. 음악 시청 히스토리 조회

| 항목         | 내용                                               |
| ------------ | -------------------------------------------------- |
| **Endpoint** | `GET /music/history`                               |
| **Return**   | `user_music_history` 목록, 최신순(created_at DESC) |

**Output (200)**

```json
{
    "success": true,
    "data": [
        {
            "id": "uuid-...",
            "video_id": "abc123",
            "title": "NewJeans - OMG",
            "capture_time": 125,
            "origin": "YouTube",
            "created_at": "2026-02-07T12:00:00.000Z"
        }
    ]
}
```

---

### 3-4. 개별 저장 단어 및 유의어 조회

| 항목         | 내용                                                |
| ------------ | --------------------------------------------------- |
| **Endpoint** | `GET /user/words`                                   |
| **Return**   | `user_words` + `word_synonyms` (단어별 유의어 배열) |

**Output (200)**

```json
{
    "success": true,
    "data": [
        {
            "id": "uuid-...",
            "word": "shine",
            "meaning": "빛나다",
            "count": 3,
            "synonyms": ["gleam", "glow"]
        }
    ]
}
```

- **DB**: user_words의 count는 동일 (user_id, word) 저장 시 누적(occurrences 반영). word_synonyms는 user_word_id로 조인.

---

## 4. [POST] 노래 제목 기반 단어장 생성 (AI)

노래 제목만 받아 Genius API로 가사를 조회한 뒤, Gemini로 단어 추출 후 단어장을 반환하고 선택 시 DB에 저장합니다. lib/genius.ts(검색·가사), vocabulary.ts, settings와 연동됩니다.

| 항목                  | 내용                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Endpoint**          | `POST /vocabulary/generate`                                                                                                                                                               |
| **설명**              | `song_title`으로 Genius 검색 → 가사 조회 → Gemini 단어 추출. 옵션은 `user_vocabulary_settings`에서 조회(없으면 기본값). 저장 시 `vocabulary_lists` + `user_words` + `word_synonyms` 동일. |
| **Input (JSON Body)** | 아래 표 참고                                                                                                                                                                              |

| 필드명     | 타입    | 필수 | 설명                                                                             |
| ---------- | ------- | :--: | -------------------------------------------------------------------------------- |
| song_title | string  |  O   | 노래 제목(검색어). Genius 검색 후 첫 결과의 가사를 사용                          |
| title      | string  |  X   | 저장 시 리스트 제목. 미지정 시 `"{곡제목} - {아티스트}"` 사용                    |
| save       | boolean |  X   | true이면 생성 결과를 vocabulary_lists + user_words + 유의어에 저장 (기본: false) |

### Output (200)

```json
{
    "success": true,
    "data": {
        "entries": [
            {
                "word": "shine",
                "score": 8,
                "meaning": "빛나다",
                "example": "shine bright",
                "synonyms": ["gleam", "glow"],
                "occurrences": 2
            }
        ],
        "saved": true,
        "song": { "title": "Shake It Off", "artist": "Taylor Swift" }
    }
}
```

- `entries`: vocabulary.ts `VocabularyEntry[]`. `occurrences`: 이번 분석에서 해당 단어 출현 횟수(user_words count 누적용).
- `saved`: 요청에 `save: true`였고 실제로 저장이 수행되면 `true`.
- `song`: Genius에서 조회한 곡 정보(제목, 아티스트).

### 에러

- **404**: `song_title`에 해당하는 곡을 Genius에서 찾지 못함.
- **502**: Genius 가사 조회 실패 (LYRICS_FETCH_FAILED).

**백엔드 연동 요약**

- Genius: `searchSongs(song_title)` → 첫 결과로 `getLyricsById(id)` → 가사 문자열 획득.
- `getVocabularyOptionsForUser(userId, getSettings)` → `createVocabularyFromLyricsForUser(lyrics, userId, env, meta)` 호출. 저장 형식은 기존과 동일(vocabulary_lists, user_words, word_synonyms).

---

## 5. [PATCH] 유저 단어장 설정 변경 (선택)

| 항목                  | 내용                   |
| --------------------- | ---------------------- |
| **Endpoint**          | `PATCH /user/settings` |
| **Input (JSON Body)** | 변경할 필드만 전송     |

| 필드명     | 타입   | 필수 | 설명                                 |
| ---------- | ------ | :--: | ------------------------------------ |
| language   | string |  X   | en \| ko                             |
| level      | string |  X   | beginner \| intermediate \| advanced |
| max_words  | number |  X   | 1~200                                |
| min_length | number |  X   | 1~20                                 |

### Output (200)

```json
{
    "success": true,
    "data": {
        "language": "en",
        "level": "intermediate",
        "max_words": 30,
        "min_length": 2
    }
}
```

- **DB**: `user_vocabulary_settings` 업데이트(또는 없으면 insert). vocabulary.ts의 옵션 범위와 동일하게 유효성 검사 권장.

---

## 6. 데이터 흐름 및 보안 (OAuth2 + JWT)

1. **Frontend**: 사용자를 `GET /v1/auth/google`로 보냄 → Google 로그인 후 `GET /v1/auth/google/callback?code=...` 호출됨.
2. **Callback**: 백엔드가 code로 액세스 토큰 교환 → Google userinfo 조회 → `users` 테이블 upsert(provider=`google`, provider_user_id=Google id) 및 `user_vocabulary_settings` 기본값 생성 → JWT 발급(payload.sub = users.id).
    - **FRONTEND_REDIRECT_URI** 설정 시: 해당 URL로 302 리다이렉트 (`#token=...&internal_id=...&is_new_user=...`).
    - 미설정 시: JSON `{ token, internal_id, is_new_user }` 반환.
3. **이후 요청**: POST/GET 모두 Header에 `Authorization: Bearer <token>` 포함. 백엔드는 JWT 검증 후 payload.sub를 내부 user id로 사용하여 쿼리 수행.

---

## 7. 프론트엔드 연동 가이드 (OAuth2 + JWT)

### 로그인 플로우 (SPA 권장)

1. **로그인 버튼**  
   사용자 클릭 시 **브라우저를** `GET {API_BASE}/v1/auth/google` 로 보냅니다.
    - 예: `window.location.href = 'http://localhost:5174/v1/auth/google'`
    - 백엔드가 Google 로그인 페이지로 302 리다이렉트합니다.

2. **콜백에서 토큰 받기**
    - **권장**: 백엔드 `.env`에 `FRONTEND_REDIRECT_URI` 설정 (예: `http://localhost:5173/auth/callback`).  
      로그인 성공 후 백엔드가 해당 URL로 리다이렉트하며 hash에 `#token=...&internal_id=...&is_new_user=...` 를 붙입니다.  
      프론트는 `/auth/callback` 라우트에서 `window.location.hash` 또는 `useSearchParams` 등으로 `token`을 읽어 로컬 스토리지/메모리에 저장한 뒤 hash 제거 및 메인으로 이동합니다.
    - **미설정 시**: Google이 `GET /v1/auth/google/callback?code=...` 로 리다이렉트하면 **API 도메인**에서 JSON `{ success, data: { token, internal_id, is_new_user } }` 가 표시됩니다. SPA는 이 응답을 직접 받기 어려우므로, SPA 사용 시 `FRONTEND_REDIRECT_URI` 설정을 권장합니다.

3. **API 요청 시**  
   모든 인증 필요 API 호출 시 요청 헤더에 다음을 넣습니다.
    - `Authorization: Bearer <저장한 token>`
    - `Content-Type: application/json` (POST/PATCH 시)

### CORS

- 백엔드(Node)는 `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: Content-Type, Authorization` 을 보냅니다.
- 다른 도메인(예: 프론트 `http://localhost:5173`)에서 API(`http://localhost:5174`) 호출 가능합니다.

### 요청 예시 (로그인 후)

```http
GET /v1/user/profile
Authorization: Bearer eyJhbGc...
Content-Type: application/json
```

```http
POST /v1/music/history
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{"video_id":"abc123","title":"Song Title"}
```

### 401 응답 시

- `success: false`, `error.code: "UNAUTHORIZED"` → 토큰 없음/만료/잘못됨.
- 저장한 토큰 삭제 후 로그인 플로우(1~2)부터 다시 진행합니다.

---

## 8. 엔드포인트 요약표

| Method | Endpoint              | 설명                                |
| ------ | --------------------- | ----------------------------------- |
| GET    | /hello                | 헬로 월드 (커넥션 테스트용)         |
| POST   | /echo                 | 요청 바디 그대로 반환 (디버깅용)    |
| GET    | /db/health            | DB 연결 상태 확인                   |
| GET    | /auth/google          | Google 로그인 페이지로 리다이렉트   |
| GET    | /auth/google/callback | code 교환 후 유저 동기화 + JWT 발급 |
| GET    | /user/profile         | 프로필 + 단어장 설정                |
| PATCH  | /user/settings        | 단어장 설정 변경                    |
| GET    | /user/words           | 저장 단어 + 유의어 목록             |
| GET    | /vocabulary/lists     | 단어장 목록(entries 포함)           |
| POST   | /vocabulary/generate  | 가사 → AI 단어장 생성(옵션 저장)    |
| POST   | /music/history        | 음악 히스토리 1건 저장              |
| GET    | /music/history        | 음악 히스토리 목록                  |

---

## 9. 참고 문서

- [db.md](./db.md) — 테이블 정의, 컬럼, 사용 흐름
- [db-schema.md](./db-schema.md) — 테이블 관계도
- `src/vocabulary.ts` — createVocabularyFromLyricsForUser, VocabularyEntry, getVocabularyOptionsForUser
- `src/db/settings.ts` — getVocabularySettings, saveVocabularyList, createGetVocabularySettings, createSaveVocabularyList
- `src/db/connect.ts` — createPool, createQueryRunner (로컬/Node)
