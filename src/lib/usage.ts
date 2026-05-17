import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// Live plan-utilization endpoints used by the Claude Code / Codex CLIs. These
// are the same endpoints the official desktop clients hit; they aren't a
// documented public API and may change shape — parsing is deliberately
// permissive (utilization / used_percent / remaining_percent are all accepted).
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_REFRESH_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_KEYCHAIN_SERVICE = "Codex Auth";

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_REFRESH_URL = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_BETA_HEADER = "oauth-2025-04-20";
const CLAUDE_DEFAULT_SCOPES =
  "user:profile user:inference user:sessions:claude_code user:mcp_servers";

const REQUEST_TIMEOUT_MS = 20_000;
const TOKEN_REFRESH_SKEW_MS = 5 * 60_000;
const DISABLE_USAGE_VALUES = new Set(["1", "true"]);

export type UsageStatus = "ok" | "stale" | "error" | "auth";

export interface UsageWindow {
  /** 0-100, fraction of the plan window still available. 100 = full quota. */
  percent: number | null;
  /** Window reset time when the endpoint provides one. */
  resetsAt: Date | null;
}

export interface ProviderUsage {
  source: "claude" | "codex";
  status: UsageStatus;
  fiveHour: UsageWindow | null;
  weekly: UsageWindow | null;
  /** Short error message when status !== "ok". */
  error?: string;
  /** Wall-clock time the value (or its error) was recorded. Stamped inside
   *  `getProvider` so every branch — success, stale, error — shares the same
   *  freshness signal regardless of which fetcher produced it. */
  fetchedAt: Date;
}

type JsonMap = Record<string, unknown>;

// ---------- public entry points ------------------------------------------

const cache: Partial<Record<ProviderUsage["source"], ProviderUsage>> = {};
const inFlight: Partial<Record<ProviderUsage["source"], Promise<ProviderUsage>>> = {};

export const isUsageFeatureDisabled = (): boolean => {
  const raw = process.env.REPOGARDEN_DISABLE_USAGE;
  if (!raw) return false;
  return DISABLE_USAGE_VALUES.has(raw.trim().toLowerCase());
};

export const loadAllUsage = async (): Promise<ProviderUsage[]> => {
  if (isUsageFeatureDisabled()) return [];
  const [codex, claude] = await Promise.all([
    getProvider("codex", fetchCodexUsage),
    getProvider("claude", fetchClaudeUsage),
  ]);
  return [codex, claude];
};

export const readClaudeUsage = (): Promise<ProviderUsage> =>
  getProvider("claude", fetchClaudeUsage, true);

export const readCodexUsage = (): Promise<ProviderUsage> =>
  getProvider("codex", fetchCodexUsage, true);

/** Fetchers return everything except the freshness stamp — `getProvider` is
 *  the single chokepoint that knows "this just resolved" and adds it. */
type FetchedProviderUsage = Omit<ProviderUsage, "fetchedAt">;

const getProvider = async (
  source: ProviderUsage["source"],
  refresh: () => Promise<FetchedProviderUsage>,
  force = false
): Promise<ProviderUsage> => {
  // Coalesce concurrent calls so the file system / network is only hit once
  // per provider per refresh cycle, no matter how many subscribers there are.
  if (!force && inFlight[source]) return inFlight[source]!;
  const p = (async () => {
    try {
      const fresh = await refresh();
      const stamped: ProviderUsage = { ...fresh, fetchedAt: new Date() };
      cache[source] = stamped;
      return stamped;
    } catch (err) {
      const message = safeError(err);
      const isAuth = isAuthLike(message);
      const prior = cache[source];
      if (prior && prior.status === "ok") {
        const stale: ProviderUsage = {
          ...prior,
          status: "stale",
          error: message,
          fetchedAt: new Date(),
        };
        cache[source] = stale;
        return stale;
      }
      const errored: ProviderUsage = {
        source,
        status: isAuth ? "auth" : "error",
        fiveHour: null,
        weekly: null,
        error: message,
        fetchedAt: new Date(),
      };
      cache[source] = errored;
      return errored;
    } finally {
      delete inFlight[source];
    }
  })();
  inFlight[source] = p;
  return p;
};

// ---------- HTTP plumbing -------------------------------------------------

interface HttpResponse {
  ok: boolean;
  status: number;
  body: unknown;
  text: string;
}

const requestJson = async (
  url: string,
  init: RequestInit
): Promise<HttpResponse> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { ok: response.ok, status: response.status, body, text };
  } finally {
    clearTimeout(timeout);
  }
};

const httpError = (label: string, response: HttpResponse): Error => {
  const body = response.body;
  const message =
    typeof body === "object" && body !== null
      ? stringAt(body as JsonMap, "message") ??
        stringAt(objectAt(body as JsonMap, "error") ?? {}, "message") ??
        JSON.stringify(body).slice(0, 180)
      : String(response.text || body || "").slice(0, 180);
  return new Error(
    `${label} HTTP ${response.status}${message ? `: ${message}` : ""}`
  );
};

// ---------- Codex ---------------------------------------------------------

interface CodexCredential {
  authData: JsonMap;
  tokens: JsonMap;
  source: "file" | "keychain";
  path?: string;
  keychainAccount?: string;
}

const getCodexHome = (): string =>
  process.env.CODEX_HOME || path.join(os.homedir(), ".codex");

const getCodexAuthPath = (): string => path.join(getCodexHome(), "auth.json");

const readCodexCredential = async (): Promise<CodexCredential> => {
  const authPath = getCodexAuthPath();
  let fileError: string | null = null;

  try {
    const authData = readJsonFile(authPath);
    const tokens = objectAt(authData, "tokens");
    if (tokens) return { authData, tokens, source: "file", path: authPath };
    fileError = `${authPath} has no tokens object.`;
  } catch (error) {
    fileError = safeError(error);
  }

  if (process.platform === "darwin") {
    try {
      const { authData, account } = await readCodexKeychain();
      const tokens = objectAt(authData, "tokens");
      if (tokens) {
        return { authData, tokens, source: "keychain", keychainAccount: account };
      }
      fileError = `macOS Keychain item ${CODEX_KEYCHAIN_SERVICE} has no tokens object.`;
    } catch (error) {
      if (!fileError) fileError = safeError(error);
    }
  }

  throw new Error(fileError ?? "Codex credentials not found. Run codex login first.");
};

const codexKeychainAccount = (): string => {
  const codexHome = getCodexHome();
  const canonical = fs.existsSync(codexHome)
    ? fs.realpathSync(codexHome)
    : path.resolve(codexHome);
  const truncated = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return `cli|${truncated}`;
};

const readCodexKeychain = async (): Promise<{ authData: JsonMap; account: string }> => {
  const account = codexKeychainAccount();
  const output = (
    await execFileAsync(
      "security",
      ["find-generic-password", "-s", CODEX_KEYCHAIN_SERVICE, "-a", account, "-w"],
      { timeout: 8_000 }
    )
  ).stdout.trim();
  return { authData: parsePossiblyHexJson(output, CODEX_KEYCHAIN_SERVICE), account };
};

const fetchCodexUsage = async (): Promise<FetchedProviderUsage> => {
  const credential = await readCodexCredential();
  const { authData, tokens } = credential;
  if (authData["auth_mode"] && authData["auth_mode"] !== "chatgpt") {
    throw new Error("Codex is not signed in with ChatGPT OAuth. Run codex login.");
  }

  let accessToken = stringAt(tokens, "access_token");
  const accountId = stringAt(tokens, "account_id");
  if (!accessToken) throw new Error("Codex credentials missing access_token. Run codex login.");
  if (!accountId) throw new Error("Codex credentials missing account_id. Run codex login.");

  if (isJwtExpiringSoon(accessToken, TOKEN_REFRESH_SKEW_MS)) {
    accessToken = await refreshCodexToken(credential);
  }

  const callUsage = (token: string) =>
    requestJson(CODEX_USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "ChatGPT-Account-Id": accountId,
        Origin: "https://chatgpt.com",
        Referer: "https://chatgpt.com/",
        "User-Agent": "Mozilla/5.0",
      },
    });

  let response = await callUsage(accessToken);
  if (response.status === 401) {
    accessToken = await refreshCodexToken(credential);
    response = await callUsage(accessToken);
  }
  if (!response.ok) throw httpError("Codex usage", response);

  const body = ensureObject(response.body, "Codex usage response");
  const { fiveHour, weekly } = parseCodexUsageBody(body);
  return { source: "codex", status: "ok", fiveHour, weekly };
};

const refreshCodexToken = async (credential: CodexCredential): Promise<string> => {
  const refreshToken = stringAt(credential.tokens, "refresh_token");
  if (!refreshToken) {
    throw new Error(
      "Codex access token expired and no refresh_token is available. Run codex login."
    );
  }

  const response = await requestJson(CODEX_REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok) throw httpError("Codex token refresh", response);

  const body = ensureObject(response.body, "Codex token refresh response");
  const newAccess = stringAt(body, "access_token");
  if (!newAccess) throw new Error("Codex token refresh did not return access_token.");

  credential.tokens["access_token"] = newAccess;
  const newId = stringAt(body, "id_token");
  const newRefresh = stringAt(body, "refresh_token");
  if (newId) credential.tokens["id_token"] = newId;
  if (newRefresh) credential.tokens["refresh_token"] = newRefresh;
  credential.authData["tokens"] = credential.tokens;
  credential.authData["last_refresh"] = new Date().toISOString();
  await persistCodexCredential(credential);
  return newAccess;
};

const persistCodexCredential = async (credential: CodexCredential): Promise<void> => {
  if (credential.source === "file" && credential.path) {
    writeJsonFile(credential.path, credential.authData);
    return;
  }
  if (credential.source === "keychain" && credential.keychainAccount) {
    await execFileAsync(
      "security",
      [
        "add-generic-password",
        "-U",
        "-s",
        CODEX_KEYCHAIN_SERVICE,
        "-a",
        credential.keychainAccount,
        "-w",
        JSON.stringify(credential.authData),
      ],
      { timeout: 8_000 }
    );
  }
};

export const parseCodexUsageBody = (
  body: JsonMap
): { fiveHour: UsageWindow | null; weekly: UsageWindow | null } => {
  const rateLimits =
    objectAt(body, "rate_limit") ?? objectAt(body, "rate_limits") ?? body;

  let fiveHour: UsageWindow | null = null;
  let weekly: UsageWindow | null = null;
  for (const key of ["five_hour", "five_hour_limit", "five_hour_rate_limit", "primary"]) {
    const value = objectAt(rateLimits, key);
    if (value) {
      fiveHour = parseCodexWindow(value);
      if (fiveHour) break;
    }
  }
  for (const key of ["weekly", "weekly_limit", "weekly_rate_limit", "secondary"]) {
    const value = objectAt(rateLimits, key);
    if (value) {
      weekly = parseCodexWindow(value);
      if (weekly) break;
    }
  }
  if (!fiveHour) fiveHour = parseCodexWindow(objectAt(rateLimits, "primary_window"));
  if (!weekly) weekly = parseCodexWindow(objectAt(rateLimits, "secondary_window"));

  // Some responses pack one window into the "primary" slot regardless of which
  // one it represents — disambiguate by the window length when available.
  const primarySeconds =
    getWindowSeconds(objectAt(rateLimits, "primary")) ??
    getWindowSeconds(objectAt(rateLimits, "primary_window"));
  const secondarySeconds =
    getWindowSeconds(objectAt(rateLimits, "secondary")) ??
    getWindowSeconds(objectAt(rateLimits, "secondary_window"));
  if (fiveHour && !weekly && primarySeconds && primarySeconds >= 6 * 24 * 3600) {
    weekly = fiveHour;
    fiveHour = null;
  }
  if (weekly && !fiveHour && secondarySeconds && secondarySeconds <= 6 * 3600) {
    fiveHour = weekly;
    weekly = null;
  }

  return { fiveHour, weekly };
};

const parseCodexWindow = (value: JsonMap | null): UsageWindow | null => {
  if (!value) return null;
  let source = value;
  const nestedPrimary = objectAt(source, "primary_window");
  if (
    !hasAnyKey(source, [
      "reset_at",
      "reset_time_ms",
      "resets_at",
      "percent_left",
      "remaining_percent",
      "used_percent",
    ]) &&
    nestedPrimary
  ) {
    source = nestedPrimary;
  }

  let percent =
    coerceNumber(source["percent_left"]) ??
    coerceNumber(source["remaining_percent"]) ??
    coerceNumber(source["available_percent"]);
  if (percent === null) {
    const used =
      coerceNumber(source["used_percent"]) ?? coerceNumber(source["utilization"]);
    if (used !== null) percent = 100 - used;
  }

  const resetsAt = parseResetAt(
    source["reset_time_ms"] ?? source["reset_at"] ?? source["resets_at"]
  );

  if (percent === null && resetsAt === null) return null;
  return {
    percent: percent === null ? null : clamp(percent, 0, 100),
    resetsAt,
  };
};

// ---------- Claude --------------------------------------------------------

interface ClaudeCredential {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scopes: string[];
  source: "env" | "file" | "keychain";
  path?: string;
  raw?: JsonMap;
  keychainAccount?: string;
}

const getClaudeCredentialPath = (): string => {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  if (dir) return path.join(dir, ".credentials.json");
  return path.join(os.homedir(), ".claude", ".credentials.json");
};

export const extractClaudeOauth = (raw: JsonMap): JsonMap | null => {
  const nested = objectAt(raw, "claudeAiOauth");
  if (nested) return nested;
  // Current Claude Code stores OAuth credentials as a flat object in some
  // environments, e.g. { "accessToken": "...", "refreshToken": "..." }. Older
  // builds wrap the same shape under `claudeAiOauth`.
  if (stringAt(raw, "accessToken") || stringAt(raw, "access_token")) return raw;
  return null;
};

const credentialFromOauth = (
  oauth: JsonMap,
  source: ClaudeCredential["source"],
  credentialPath: string | undefined,
  raw: JsonMap,
  keychainAccount?: string
): ClaudeCredential => {
  const accessToken =
    stringAt(oauth, "accessToken") ?? stringAt(oauth, "access_token") ?? "";
  const refreshToken =
    stringAt(oauth, "refreshToken") ?? stringAt(oauth, "refresh_token");
  const expiresAt = normalizeEpochMs(oauth["expiresAt"] ?? oauth["expires_at"]);
  const scopesValue = oauth["scopes"] ?? oauth["scope"];
  const scopes = Array.isArray(scopesValue)
    ? scopesValue.map(String).filter(Boolean)
    : splitScopes(
        typeof scopesValue === "string" ? scopesValue : CLAUDE_DEFAULT_SCOPES
      );
  return {
    accessToken,
    refreshToken: refreshToken ?? null,
    expiresAt,
    scopes,
    source,
    path: credentialPath,
    raw,
    keychainAccount,
  };
};

const readClaudeCredential = async (): Promise<ClaudeCredential> => {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (envToken) {
    return {
      accessToken: envToken,
      refreshToken: process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN ?? null,
      expiresAt: null,
      scopes: splitScopes(
        process.env.CLAUDE_CODE_OAUTH_SCOPES ?? CLAUDE_DEFAULT_SCOPES
      ),
      source: "env",
    };
  }

  const errors: string[] = [];

  if (process.platform === "darwin") {
    try {
      const { raw, account } = await readClaudeKeychain();
      const oauth = extractClaudeOauth(raw);
      if (oauth) return credentialFromOauth(oauth, "keychain", undefined, raw, account);
      errors.push("macOS Keychain item Claude Code-credentials has no OAuth token");
    } catch (error) {
      errors.push(safeError(error));
    }
  }

  try {
    const credentialPath = getClaudeCredentialPath();
    const raw = readJsonFile(credentialPath);
    const oauth = extractClaudeOauth(raw);
    if (oauth) return credentialFromOauth(oauth, "file", credentialPath, raw);
    errors.push(`${credentialPath} has no Claude Code OAuth token`);
  } catch (error) {
    errors.push(safeError(error));
  }

  throw new Error(
    `Claude Code OAuth token not found. Run claude and log in first. ${errors.join(" | ")}`
  );
};

const readClaudeKeychain = async (): Promise<{ raw: JsonMap; account?: string }> => {
  const accounts = uniqueStrings([
    process.env.CLAUDE_CODE_KEYCHAIN_ACCOUNT,
    process.env.USER,
    os.userInfo().username,
    "claude",
  ]);
  const attempts: Array<string | undefined> = [...accounts, undefined];
  const errors: string[] = [];
  for (const account of attempts) {
    const args = ["find-generic-password"];
    if (account) args.push("-a", account);
    args.push("-s", "Claude Code-credentials", "-w");
    try {
      const output = (
        await execFileAsync(securityBinary(), args, { timeout: 8_000 })
      ).stdout.trim();
      return { raw: parsePossiblyHexJson(output, "Claude Code-credentials"), account };
    } catch (error) {
      errors.push(`${account ?? "default"}: ${safeError(error)}`);
    }
  }
  throw new Error(`Claude Code Keychain not found. ${errors.join(" | ")}`);
};

const fetchClaudeUsage = async (): Promise<FetchedProviderUsage> => {
  let credential = await readClaudeCredential();
  if (!credential.accessToken) {
    throw new Error("Claude Code OAuth token not found. Run claude and log in.");
  }
  if (
    credential.expiresAt &&
    Date.now() > credential.expiresAt - TOKEN_REFRESH_SKEW_MS
  ) {
    credential = await refreshClaudeToken(credential);
  }

  const callUsage = (token: string) =>
    requestJson(CLAUDE_USAGE_URL, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "User-Agent": "claude-code/2.0.32",
        Authorization: `Bearer ${token}`,
        "anthropic-beta": CLAUDE_BETA_HEADER,
      },
    });

  let response = await callUsage(credential.accessToken);
  if (response.status === 401 && credential.refreshToken) {
    credential = await refreshClaudeToken(credential);
    response = await callUsage(credential.accessToken);
  }
  if (!response.ok) throw httpError("Claude usage", response);

  const body = ensureObject(response.body, "Claude usage response");
  const { fiveHour, weekly } = parseClaudeUsageBody(body);
  return { source: "claude", status: "ok", fiveHour, weekly };
};

const refreshClaudeToken = async (
  credential: ClaudeCredential
): Promise<ClaudeCredential> => {
  if (!credential.refreshToken) {
    throw new Error(
      "Claude OAuth token expired and no refresh token is available. Run claude login."
    );
  }
  const response = await requestJson(CLAUDE_REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: credential.refreshToken,
      client_id: CLAUDE_CLIENT_ID,
    }),
  });
  if (!response.ok) throw httpError("Claude token refresh", response);
  const body = ensureObject(response.body, "Claude token refresh response");
  const accessToken =
    stringAt(body, "access_token") ?? stringAt(body, "accessToken");
  if (!accessToken) throw new Error("Claude token refresh did not return access_token.");
  const refreshToken =
    stringAt(body, "refresh_token") ??
    stringAt(body, "refreshToken") ??
    credential.refreshToken;
  const expiresIn =
    coerceNumber(body["expires_in"]) ??
    coerceNumber(body["expiresIn"]) ??
    8 * 60 * 60;
  const bodyScopes = stringAt(body, "scope")
    ? splitScopes(stringAt(body, "scope")!)
    : credential.scopes;
  const updated: ClaudeCredential = {
    ...credential,
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    scopes: bodyScopes,
  };
  await persistClaudeCredential(updated);
  return updated;
};

const persistClaudeCredential = async (credential: ClaudeCredential): Promise<void> => {
  if (credential.source === "env" || !credential.raw) return;
  const nestedOauth = objectAt(credential.raw, "claudeAiOauth");
  const oauth = nestedOauth ?? credential.raw;
  oauth["accessToken"] = credential.accessToken;
  if (credential.refreshToken) oauth["refreshToken"] = credential.refreshToken;
  if (credential.expiresAt) oauth["expiresAt"] = credential.expiresAt;
  oauth["scopes"] = credential.scopes;
  if (nestedOauth) credential.raw["claudeAiOauth"] = oauth;
  if (credential.source === "file" && credential.path) {
    writeJsonFile(credential.path, credential.raw);
    return;
  }
  if (credential.source === "keychain") {
    const account =
      credential.keychainAccount ||
      process.env.CLAUDE_CODE_KEYCHAIN_ACCOUNT ||
      process.env.USER ||
      os.userInfo().username ||
      "claude";
    await execFileAsync(
      securityBinary(),
      [
        "add-generic-password",
        "-U",
        "-s",
        "Claude Code-credentials",
        "-a",
        account,
        "-w",
        JSON.stringify(credential.raw),
      ],
      { timeout: 8_000 }
    );
  }
};

export const parseClaudeUsageBody = (
  body: JsonMap
): { fiveHour: UsageWindow | null; weekly: UsageWindow | null } => {
  return {
    fiveHour: parseClaudeWindow(objectAt(body, "five_hour")),
    weekly: parseClaudeWindow(
      objectAt(body, "seven_day") ?? objectAt(body, "weekly")
    ),
  };
};

const parseClaudeWindow = (value: JsonMap | null): UsageWindow | null => {
  if (!value) return null;
  let percent =
    coerceNumber(value["remaining_percent"]) ??
    coerceNumber(value["percent_left"]);
  if (percent === null) {
    const used =
      coerceNumber(value["utilization"]) ?? coerceNumber(value["used_percent"]);
    if (used !== null) percent = 100 - used;
  }
  const resetsAt = parseResetAt(
    value["resets_at"] ?? value["reset_at"] ?? value["resetTime"]
  );
  if (percent === null && resetsAt === null) return null;
  return {
    percent: percent === null ? null : clamp(percent, 0, 100),
    resetsAt,
  };
};

// ---------- shared helpers ------------------------------------------------

const execFileAsync = promisify(execFile);

const securityBinary = (): string =>
  fs.existsSync("/usr/bin/security") ? "/usr/bin/security" : "security";

const readJsonFile = (filePath: string): JsonMap => {
  try {
    return ensureObject(JSON.parse(fs.readFileSync(filePath, "utf8")), filePath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(`${filePath} not found.`);
    }
    throw error;
  }
};

const writeJsonFile = (filePath: string, data: JsonMap): void => {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows ACL doesn't map; the user profile permissions already cover it.
  }
};

const parsePossiblyHexJson = (text: string, label: string): JsonMap => {
  try {
    return ensureObject(JSON.parse(text), label);
  } catch {
    if (/^[0-9a-fA-F]+$/.test(text) && text.length % 2 === 0) {
      return ensureObject(
        JSON.parse(Buffer.from(text, "hex").toString("utf8")),
        label
      );
    }
    throw new Error(`${label} is not valid JSON.`);
  }
};

const isJwtExpiringSoon = (token: string, skewMs: number): boolean => {
  const exp = jwtExpMs(token);
  return exp !== null && Date.now() > exp - skewMs;
};

const jwtExpMs = (token: string): number | null => {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(
      payload.length + ((4 - (payload.length % 4)) % 4),
      "="
    );
    const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    const exp = Number(parsed.exp);
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
};

const parseResetAt = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== "") return parseResetAt(numeric);
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
};

const normalizeEpochMs = (value: unknown): number | null => {
  const n = coerceNumber(value);
  if (n === null) return null;
  return n > 10_000_000_000 ? n : n * 1000;
};

const splitScopes = (scope: string): string[] =>
  scope.split(/\s+/).map((s) => s.trim()).filter(Boolean);

const getWindowSeconds = (value: JsonMap | null): number | null => {
  if (!value) return null;
  return (
    coerceNumber(value["limit_window_seconds"]) ??
    coerceNumber(value["window_seconds"])
  );
};

const hasAnyKey = (value: JsonMap, keys: string[]): boolean =>
  keys.some((k) => Object.prototype.hasOwnProperty.call(value, k));

const objectAt = (value: JsonMap | null | undefined, key: string): JsonMap | null => {
  const v = value?.[key];
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as JsonMap) : null;
};

const stringAt = (value: JsonMap, key: string): string | null => {
  const v = value[key];
  return typeof v === "string" && v.length > 0 ? v : null;
};

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const ensureObject = (value: unknown, label: string): JsonMap => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonMap;
  }
  throw new Error(`${label} is not a JSON object.`);
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const uniqueStrings = (values: Array<string | undefined | null>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
};

const safeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isAuthLike = (message: string): boolean =>
  /\b(token|auth|login|credential|unauth|401)\b/i.test(message);
