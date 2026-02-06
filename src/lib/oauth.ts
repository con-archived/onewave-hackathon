/**
 * Google OAuth2: authorize URL 생성, code 교환, userinfo 조회.
 * 환경변수: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_REDIRECT_URI
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export interface OAuthEnv {
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    OAUTH_REDIRECT_URI: string;
}

export interface GoogleUserInfo {
    id: string;
    email?: string;
    name?: string;
    picture?: string;
}

/**
 * 로그인 시작: Google 로그인 페이지로 리다이렉트할 URL 반환.
 * state는 CSRF 방지용; callback에서 검증 권장.
 */
export function getGoogleAuthorizeUrl(env: OAuthEnv, state?: string): string {
    const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: env.OAUTH_REDIRECT_URI,
        response_type: "code",
        scope: "openid email profile",
        ...(state && { state }),
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * callback의 code로 액세스 토큰 교환 후 userinfo 조회.
 */
export async function exchangeCodeAndGetUserInfo(
    code: string,
    env: OAuthEnv
): Promise<GoogleUserInfo> {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: env.OAUTH_REDIRECT_URI,
            grant_type: "authorization_code",
        }),
    });
    if (!tokenRes.ok) {
        const text = await tokenRes.text();
        throw new Error(`Token exchange failed: ${tokenRes.status} ${text}`);
    }
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) throw new Error("No access_token in response");

    const userRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) {
        const text = await userRes.text();
        throw new Error(`Userinfo failed: ${userRes.status} ${text}`);
    }
    const user = (await userRes.json()) as GoogleUserInfo;
    if (!user?.id) throw new Error("Invalid userinfo: missing id");
    return user;
}
