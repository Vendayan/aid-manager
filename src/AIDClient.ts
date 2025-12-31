import * as vscode from "vscode";
import { AuthService, AuthState } from "./AuthService";
import { FIELD_BY_EVENT, Scenario, ScriptEvent } from "./AIDTypes";

type GraphQLRequest = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

type GraphQLError = {
  message: string;
  extensions?: unknown;
  path?: (string | number)[]
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLError[]
};

export class AIDClient {

  constructor(private ctx: vscode.ExtensionContext, private auth: AuthService) { }

  async preflightAuth(): Promise<AuthState> {
    return this.auth.authState();
  }

  private endpoint(): string {
    const cfg = vscode.workspace.getConfiguration();
    const ep = cfg.get<string>("aid-manager.AIDEndpoint", "https://api.aidungeon.com/graphql");
    if (!ep) {
      throw new Error("GraphQL endpoint not configured (aid-manager.AIDEndpoint).");
    }
    return ep;
  }

  private authHeaders(token: string, operationName?: string): Record<string, string> {
    const cfg = vscode.workspace.getConfiguration();
    const headerName = cfg.get<string>("aid-manager.authHeaderName", "Authorization");
    const fmt = cfg.get<string>("aid-manager.authHeaderFormat", "firebase ${token}");

    const lang = (vscode.env.language || "en").toLowerCase();
    const primary = lang.includes("-") ? lang : `${lang}-us`;
    const acceptLang = `${primary},en;q=0.9`;

    const base: Record<string, string> = {
      "content-type": "application/json",
      "accept": "*/*",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "accept-language": acceptLang,
      [headerName]: fmt.replace("${token}", token)
    };

    if (operationName) {
      base["x-gql-operation-name"] = operationName;
    }
    return base;
  }

  async gql<T>(req: GraphQLRequest): Promise<T> {
    let token: string;
    try {
      token = await this.auth.ensureValidToken();
    } catch (e: any) {
      const code = e?.message;
      if (code === "AUTH_MISSING" || code === "AUTH_EXPIRED") {
        throw e;
      }
      throw new Error("AUTH_MISSING");
    }

    const resp = await fetch(this.endpoint(), {
      method: "POST",
      headers: this.authHeaders(token, req.operationName),
      body: JSON.stringify(req)
    });

    if (resp.status === 401 || resp.status === 403) {
      throw new Error("AUTH_EXPIRED");
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`GraphQL HTTP ${resp.status}: ${text}`);
    }

    const raw = await resp.text();
    const json = JSON.parse(raw) as GraphQLResponse<T>;
    if (json.errors?.length) {
      const msg = json.errors.map(e => e.message).join("; ");
      throw new Error(`GraphQL Error: ${msg}`);
    }
    if (!json.data) {
      throw new Error("GraphQL response had no data.");
    }
    return json.data;
  }

  // ---------- AID API Calls (all GraphQL lives here) ----------

  /** Back-compat: returns just the first page (limit=120). */
  async listScenarios(): Promise<Scenario[]> {
    const { items } = await this.listScenariosPage({ limit: 120, offset: 0 });
    return items;
  }

  /** Paged listing. hasMore is true when server returned a full page. */
  async listScenariosPage(opts?: { limit?: number; offset?: number }): Promise<{ items: Scenario[]; hasMore: boolean; }> {
    type Searchable = {
      id: string;
      shortId: string;
      title: string;
      description?: string | null;
      image?: string | null;
      contentType?: string | null;
      isOwner?: boolean | null;
      curationTags?: string[] | null;
    };
    type Resp = { search: { items: Searchable[]; hasMore: boolean; } };

    const query = `
      query OpenSearch($input: SearchInput!) {
        search(input: $input) {
          items {
            id
            shortId
            title
            description
            image
            curationTags
            contentType
            isOwner
          }
          hasMore
        }
      }
    `;
    const cfg = vscode.workspace.getConfiguration();
    const username = cfg.get<string>("aid-manager.userName", "");
    const limit = Math.max(1, Math.min(500, opts?.limit ?? 120));
    const offset = Math.max(0, opts?.offset ?? 0);

    const variables = {
      input: {
        contentType: ["scenario"],
        sortOrder: "updated",
        safe: false,
        contentRatingFilters: ["Unrated"],
        username: username || undefined,
        screen: "profile",
        limit,
        offset
      }
    };

    const data = await this.gql<Resp>({ query, variables, operationName: "OpenSearch" });
    const itemsRaw = data.search?.items ?? [];
    const items = itemsRaw
      .filter(i => i.contentType?.toLowerCase() === "scenario" && i.isOwner)
      .map(i => ({
        id: i.id,
        shortId: i.shortId,
        title: i.title,
        description: i.description ?? "",
        image: i.image ?? "",
        tags: Array.isArray(i.curationTags) ? i.curationTags : [],
        createdAt: new Date(0),
        contentType: i.contentType ?? "scenario"
      }));

    const hasMore = Boolean(data.search?.hasMore);
    return { items, hasMore: hasMore && itemsRaw.length >= limit };
  }

  /**
   * Determine if a scenario is a container (has real child options) and return children.
   * We filter out the header option: the one whose shortId equals the root shortId.
   */
  async getScenarioInfo(shortId: string): Promise<{ isContainer: boolean; children: Scenario[] }> {
    type Opt = {
      id: string;
      shortId: string;
      title: string;
      parentScenarioId?: string | null;
      __typename?: string;
    };
    type Resp = { scenario: { id: string; shortId: string; options?: Opt[] | null } | null };

    const query = `
      query GetScenario($shortId: String) {
        scenario(shortId: $shortId) {
          id
          shortId
          options {
            id
            shortId
            title
            parentScenarioId
            __typename
          }
        }
      }`;

    const res = await this.gql<Resp>({ query, variables: { shortId }, operationName: "GetScenario" });
    const root = res?.scenario;
    const rawOpts: Opt[] = Array.isArray(root?.options) ? (root!.options as Opt[]) : [];

    const children = rawOpts
      .filter(o => o.shortId !== root?.shortId && o.parentScenarioId !== null)
      .map(o => ({
        id: o.id,
        shortId: o.shortId,
        parentId: o.parentScenarioId ?? root?.id,
        title: o.title,
        description: "",
        image: "",
        tags: [],
        createdAt: undefined
      }));

    const isContainer = children.length > 0;
    return { isContainer, children };
  }

  /**
   * Full scenario JSON (for JSON editor / export). Read-only for now.
   * Includes many fields and the child options (options).
   */
  async getScenarioFull(shortId: string): Promise<any> {
    type Resp = {
      scenario: any | null;
    };
    const query = `
      query GetScenario($shortId: String) {
        scenario(shortId: $shortId) {
          id
          contentType
          createdAt
          editedAt
          publicId
          shortId
          title
          description
          prompt
          memory
          authorsNote
          image
          isOwner
          published
          unlisted
          allowComments
          showComments
          commentCount
          voteCount
          saveCount
          storyCardCount
          tags
          adventuresPlayed
          thirdPerson
          nsfw
          contentRating
          contentRatingLockedAt
          contentRatingLockedMessage
          type
          publishedAt
          deletedAt
          blockedAt
          userId
          parentScenario {
            id
            shortId
            title
            __typename
          }
          options {
            id
            userId
            shortId
            title
            prompt
            parentScenarioId
            deletedAt
            __typename
          }
          user {
            isCurrentUser
            isMember
            profile {
              title
              thumbImageUrl
              __typename
            }
            __typename
          }
          storyCards {
            id
            type
            keys
            value
            title
            useForCharacterCreation
            description
            updatedAt
            deletedAt
            __typename
          }
          state(viewPublished: false) {
            scenarioId
            type
            storySummary
            storyCardInstructions
            storyCardStoryInformation
            scenarioStateVersion
            instructions
            __typename
          }
          __typename
        }
      }`;
    const res = await this.gql<Resp>({ query, variables: { shortId }, operationName: "GetScenario" });
    return res.scenario ?? {};
  }

  async getScenarioScripting(shortId: string): Promise<{
    gameCodeSharedLibrary?: string | null;
    gameCodeOnInput?: string | null;
    gameCodeOnOutput?: string | null;
    gameCodeOnModelContext?: string | null;
  }> {
    type Resp = {
      scenario: {
        gameCodeSharedLibrary?: string | null;
        gameCodeOnInput?: string | null;
        gameCodeOnOutput?: string | null;
        gameCodeOnModelContext?: string | null;
      } | null;
    };
    const query = `
      query GetScenarioScripting($shortId: String) {
        scenario(shortId: $shortId) {
          gameCodeSharedLibrary
          gameCodeOnInput
          gameCodeOnOutput
          gameCodeOnModelContext
        }
      }`;
    const res = await this.gql<Resp>({ query, variables: { shortId }, operationName: "GetScenarioScripting" });
    return res.scenario ?? {};
  }

  async getScenarioScriptField(shortId: string, event: ScriptEvent): Promise<string> {
    const field = FIELD_BY_EVENT[event];
    type Resp = { scenario: Record<string, string | null> | null };
    const query = `
      query GetScenarioScripting($shortId: String) {
        scenario(shortId: $shortId) {
          ${field}
        }
      }`;
    const res = await this.gql<Resp>({ query, variables: { shortId }, operationName: "GetScenarioScripting" });
    const val = res?.scenario?.[field];
    return typeof val === "string" ? val : "";
  }

  /** Update all four script fields in one shot and return the updated texts (from the mutation). */
  async updateScenarioScripts(shortId: string, gameCode: {
    sharedLibrary: string | null;
    onInput: string | null;
    onOutput: string | null;
    onModelContext: string | null;
  }): Promise<{
    success: boolean;
    message?: string | null;
    scenario?: {
      gameCodeSharedLibrary?: string | null;
      gameCodeOnInput?: string | null;
      gameCodeOnOutput?: string | null;
      gameCodeOnModelContext?: string | null;
    } | null;
  }> {
    const query = `
      mutation UpdateScenarioScripts($shortId: String, $gameCode: JSONObject) {
        updateScenarioScripts(shortId: $shortId, gameCode: $gameCode) {
          success
          message
          scenario {
            id
            gameCodeSharedLibrary
            gameCodeOnInput
            gameCodeOnOutput
            gameCodeOnModelContext
            __typename
          }
          __typename
        }
      }`;
    type Resp = {
      updateScenarioScripts: {
        success: boolean;
        message?: string | null;
        scenario?: {
          gameCodeSharedLibrary?: string | null;
          gameCodeOnInput?: string | null;
          gameCodeOnOutput?: string | null;
          gameCodeOnModelContext?: string | null;
        } | null;
      } | null;
    };

    const res = await this.gql<Resp>({
      query,
      variables: { shortId, gameCode },
      operationName: "UpdateScenarioScripts"
    });

    const payload = res.updateScenarioScripts;
    if (!payload?.success) {
      throw new Error(payload?.message || "updateScenarioScripts failed");
    }
    return payload;
  }

  private ensureStoryCardContentType(contentType?: string): string {
    const normalized = (contentType || "scenario").toLowerCase();
    return normalized === "adventure" ? "adventure" : "scenario";
  }

  private randomStoryCardId(): string {
    return Math.floor(Math.random() * 1_000_000_000).toString();
  }

  async createStoryCard(input: {
    shortId: string;
    contentType?: string;
    id?: string;
    type?: string;
    title?: string;
    description?: string;
    keys?: string;
    value?: string;
    useForCharacterCreation?: boolean;
    autoGenerate?: boolean;
    instructions?: string;
    storyInformation?: string;
    temperature?: number;
    includeStorySummary?: boolean;
  }): Promise<any> {
    const payload = {
      id: input.id ?? this.randomStoryCardId(),
      shortId: input.shortId,
      contentType: this.ensureStoryCardContentType(input.contentType),
      type: input.type ?? "card",
      title: input.title ?? "",
      description: input.description ?? "",
      keys: input.keys ?? "",
      value: input.value ?? "",
      useForCharacterCreation: input.useForCharacterCreation ?? true,
      autoGenerate: input.autoGenerate ?? false,
      instructions: input.instructions ?? "",
      storyInformation: input.storyInformation ?? "",
      temperature: typeof input.temperature === "number" ? input.temperature : 1,
      includeStorySummary: input.includeStorySummary ?? false,
    };

    const query = `
      mutation CreateStoryCard($input: CreateStoryCardInput!) {
        createStoryCard(input: $input) {
          success
          message
          storyCard {
            id
            type
            title
            description
            keys
            value
            useForCharacterCreation
            updatedAt
            __typename
          }
          __typename
        }
      }
    `;

    type Resp = {
      createStoryCard?: {
        success: boolean;
        message?: string | null;
        storyCard?: any;
      } | null;
    };

    const res = await this.gql<Resp>({
      query,
      variables: { input: payload },
      operationName: "CreateStoryCard"
    });

    if (!res?.createStoryCard?.success) {
      throw new Error(res?.createStoryCard?.message || "createStoryCard failed");
    }
    return res.createStoryCard.storyCard;
  }

  async updateStoryCard(input: {
    id: string;
    shortId: string;
    contentType?: string;
    type?: string;
    title?: string;
    description?: string;
    keys?: string;
    value?: string;
    useForCharacterCreation?: boolean;
  }): Promise<any> {
    const payload = {
      id: input.id,
      shortId: input.shortId,
      contentType: this.ensureStoryCardContentType(input.contentType),
      type: input.type ?? "card",
      title: input.title ?? "",
      description: input.description ?? input.value ?? "",
      keys: input.keys ?? "",
      value: input.value ?? "",
      useForCharacterCreation: input.useForCharacterCreation ?? true
    };

    const query = `
      mutation UpdateStoryCard($input: UpdateStoryCardInput!) {
        updateStoryCard(input: $input) {
          success
          message
          storyCard {
            id
            type
            title
            description
            keys
            value
            useForCharacterCreation
            updatedAt
            __typename
          }
          __typename
        }
      }
    `;

    type Resp = {
      updateStoryCard?: {
        success: boolean;
        message?: string | null;
        storyCard?: any;
      } | null;
    };

    const res = await this.gql<Resp>({
      query,
      variables: { input: payload },
      operationName: "UpdateStoryCard"
    });

    if (!res?.updateStoryCard?.success) {
      throw new Error(res?.updateStoryCard?.message || "updateStoryCard failed");
    }
    return res.updateStoryCard.storyCard;
  }

  async deleteStoryCard(input: { id: string; shortId: string; contentType?: string; }): Promise<void> {
    const payload = {
      id: input.id,
      shortId: input.shortId,
      contentType: this.ensureStoryCardContentType(input.contentType)
    };

    const query = `
      mutation DeleteStoryCard($input: DeleteStoryCardInput!) {
        deleteStoryCard(input: $input) {
          success
          message
          __typename
        }
      }
    `;

    type Resp = {
      deleteStoryCard?: {
        success: boolean;
        message?: string | null;
      } | null;
    };

    const res = await this.gql<Resp>({
      query,
      variables: { input: payload },
      operationName: "DeleteStoryCard"
    });

    if (!res?.deleteStoryCard?.success) {
      throw new Error(res?.deleteStoryCard?.message || "deleteStoryCard failed");
    }
  }

  async updateScenario(input: {
    shortId: string;
    title?: string;
    description?: string;
    prompt?: string;
    memory?: string;
    authorsNote?: string;
    tags?: string[];
    contentRating?: string | null;
    allowComments?: boolean;
    details?: Record<string, unknown> | null;
  }): Promise<any> {
    const payload = {
      ...input,
      tags: Array.isArray(input.tags) ? input.tags : undefined,
      details: input.details ?? undefined
    };

    const query = `
      mutation UpdateScenario($input: ScenarioInput) {
        updateScenario(input: $input) {
          success
          code
          message
          scenario {
            id
            shortId
            title
            description
            prompt
            memory
            authorsNote
            tags
            contentRating
            allowComments
            editedAt
            createdAt
            publicId
            state(viewPublished: false) {
              scenarioId
              type
              storySummary
              storyCardInstructions
              storyCardStoryInformation
              scenarioStateVersion
              instructions
            }
          }
        }
      }
    `;

    type Resp = {
      updateScenario?: {
        success: boolean;
        code?: number | null;
        message?: string | null;
        scenario?: any;
      } | null;
    };

    const res = await this.gql<Resp>({
      query,
      variables: { input: payload },
      operationName: "UpdateScenario"
    });

    if (!res?.updateScenario?.success) {
      throw new Error(res?.updateScenario?.message || "updateScenario failed");
    }
    return res.updateScenario.scenario ?? {};
  }
}
