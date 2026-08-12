import * as vscode from "vscode";

const TOKEN_KEY = "aid-manager.token";          // Firebase ID token (JWT)
const REFRESH_KEY = "aid-manager.refreshToken"; // Firebase refresh token

type SignInPasswordResp = {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
};

type RefreshResp = {
  id_token: string;
  refresh_token: string;
  expires_in: string;
};

export type AuthState = "valid" | "expired" | "missing";

export class AuthService {
  constructor(private ctx: vscode.ExtensionContext) { }

  // ----- Public API -----
  async getToken(): Promise<string | undefined> {
    return this.ctx.secrets.get(TOKEN_KEY);
  }


  async getRefreshToken(): Promise<string | undefined> {
    return this.ctx.secrets.get(REFRESH_KEY);
  }


  async signOut(): Promise<void> {
    await this.ctx.secrets.delete(TOKEN_KEY);
    await this.ctx.secrets.delete(REFRESH_KEY);
  }


  async signInFlow(): Promise<boolean> {
    const method = await vscode.window.showQuickPick(
      [
        { label: "Email + Password (If using SSO define password in Account Settings -> Manage Account)", method: "password" as const },
        { label: "Paste Tokens Manually", method: "token" as const }
      ],
      { placeHolder: "Choose how to sign in to AI Dungeon" }
    );
    if (!method) { return false; }

    // --- OPTION A: Email & Password Flow ---
    if (method.method === "password") {
      const email = await vscode.window.showInputBox({ 
        prompt: "AI Dungeon Account Email", 
        validateInput: v => (v ? undefined : "Email is required") 
      });
      if (!email) { return false; }

      const password = await vscode.window.showInputBox({ 
        prompt: "AI Dungeon Password", 
        password: true, 
        validateInput: v => (v ? undefined : "Password is required") 
      });
      if (!password) { return false; }

      try {
        // Exchange email + password for BOTH idToken and refreshToken
        const { idToken, refreshToken } = await this.exchangeEmailPasswordForToken(email, password);
        
        await this.ctx.secrets.store(TOKEN_KEY, idToken);
        await this.ctx.secrets.store(REFRESH_KEY, refreshToken);

        vscode.window.showInformationMessage("Signed in successfully! Auto-refresh is now active.");
        return true;
      } catch (err: any) {
        vscode.window.showErrorMessage(`Sign-in failed: ${err?.message ?? err}`);
        return false;
      }
    }

    // --- OPTION B: Manual Tokens Fallback ---
    const token = await vscode.window.showInputBox({ 
      prompt: "Step 1/2: Paste Firebase ID token (JWT)", 
      password: true, 
      validateInput: v => (v?.trim() ? undefined : "ID Token is required") 
    });
    if (!token) { return false; }

    const refreshToken = await vscode.window.showInputBox({ 
      prompt: "Step 2/2: Paste Firebase Refresh Token", 
      password: true, 
      validateInput: v => (v?.trim() ? undefined : "Refresh Token is required") 
    });
    if (!refreshToken) { return false; }

    await this.ctx.secrets.store(TOKEN_KEY, token.trim());
    await this.ctx.secrets.store(REFRESH_KEY, refreshToken.trim());

    vscode.window.showInformationMessage("Tokens saved! Auto-refresh is active.");
    return true;
  }


  async authState(): Promise<AuthState> {
    const tok = await this.getToken();
    if (!tok) { return "missing"; }

    const expired = isJwtExpired(tok);
    if (!expired) { return "valid"; }

    const rTok = await this.getRefreshToken();
    if (!rTok) { return "expired"; }

    try {
      const { id_token, refresh_token } = await this.refreshIdToken(rTok);
      await this.ctx.secrets.store(TOKEN_KEY, id_token);
      await this.ctx.secrets.store(REFRESH_KEY, refresh_token);
      return "valid";
    } catch {
      return "expired";
    }
  }


  async ensureValidToken(): Promise<string> {
    const state = await this.authState();
    if (state === "valid") {
      const tok = await this.getToken();
      if (!tok) { throw new Error("AUTH_MISSING"); } // should not happen
      return tok;
    }
    if (state === "missing") { throw new Error("AUTH_MISSING"); }
    throw new Error("AUTH_EXPIRED");
  }


  private firebaseApiKey(): string {
    const cfg = vscode.workspace.getConfiguration();
    const key = cfg.get<string>("aid-manager.firebaseApiKey", "");
    if (!key) { throw new Error("Missing Firebase API key (aid-manager.firebaseApiKey)."); }
    return key;
  }


  // This isn't used - yet...
  private async exchangeEmailPasswordForToken(email: string, password: string): Promise<SignInPasswordResp> {
    const key = this.firebaseApiKey();
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { 
        "content-type": "application/json",
        "Referer": "https://play.aidungeon.com/",
        "Origin": "https://play.aidungeon.com"
      },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text || "signInWithPassword failed"}`);
    }

    const data = JSON.parse(await resp.text()) as SignInPasswordResp;
    if (!data.idToken || !data.refreshToken) { throw new Error("Firebase did not return tokens."); }
    return data;
  }


  // Firebase Secure Token: refresh_token -> id_token + refresh_token
  // Not doing much, but harmless for now.
  private async refreshIdToken(refreshToken: string): Promise<RefreshResp> {
    const key = this.firebaseApiKey();
    const url = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(key)}`;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    });

    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text || "token refresh failed"}`);
    }

    const data = JSON.parse(await resp.text()) as RefreshResp;
    if (!data.id_token || !data.refresh_token) { throw new Error("Refresh did not return tokens."); }
    return data;
  }
}


// Treat non-JWTs or malformed tokens as EXPIRED so it doesn’t 'look' authed.
function isJwtExpired(jwt: string): boolean {
  const parts = jwt.split(".");
  // If it's not a 3-part JWT, force refresh/re-auth
  if (parts.length !== 3) { return true; }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8")) as { exp?: number };
    // Missing/invalid exp => treat as expired
    if (typeof payload.exp !== "number") { return true; }
    const now = Math.floor(Date.now() / 1000); // I think this should be 3600?
    return now >= payload.exp - 30; // 30s skew buffer
  } catch {
    // Bad base64/JSON => treat as expired
    return true;
  }
}
