import * as vscode from "vscode";
import { AIDClient } from "./AIDClient";
import { ScriptEvent } from "./AIDTypes";

export type RemoteSaveFn = (args: {
  scenarioShortId: string;
  event: ScriptEvent;
  content: string;
}) => Promise<void>;

type ScenarioJsonReader = (shortId: string) => Promise<Buffer>;
type ScenarioJsonWriter = (shortId: string, content: Uint8Array) => Promise<void>;

type ScriptSnapshot = {
  sharedLibrary: string | null;
  onInput: string | null;
  onOutput: string | null;
  onModelContext: string | null;
};

/**
 * Implements the read/write surface behind the `aid:` virtual scheme.
 * Script files are cached per scenario in `snapshots` so concurrent editors
 * can reuse fetched text; callers must explicitly clear the cache when they
 * know the server data changed (e.g. refresh command or after an export).
 */
export class AidFsProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

  private remoteSave: RemoteSaveFn;
  private scenarioJsonReader: ScenarioJsonReader;
  private scenarioJsonWriter?: ScenarioJsonWriter;

  private snapshots = new Map<string, ScriptSnapshot>();

  public constructor(
    private client: AIDClient,
    remoteSave: RemoteSaveFn,
    scenarioJsonReader: ScenarioJsonReader
  ) {
    this.remoteSave = remoteSave;
    this.scenarioJsonReader = scenarioJsonReader;
  }

  public setRemoteSave(fn: RemoteSaveFn) {
    this.remoteSave = fn;
  }

  public setScenarioJsonReader(fn: ScenarioJsonReader) {
    this.scenarioJsonReader = fn;
  }

  public setScenarioJsonWriter(fn: ScenarioJsonWriter) {
    this.scenarioJsonWriter = fn;
  }

  /** Replace the cached snapshot and notify all virtual files for the scenario. */
  public applyServerSnapshot(shortId: string, snap: ScriptSnapshot): void {
    this.snapshots.set(shortId, {
      sharedLibrary: snap.sharedLibrary ?? null,
      onInput: snap.onInput ?? null,
      onOutput: snap.onOutput ?? null,
      onModelContext: snap.onModelContext ?? null
    });

    const events: vscode.FileChangeEvent[] = [];
    const eventsList: ScriptEvent[] = ["sharedLibrary", "onInput", "onOutput", "onModelContext"];
    for (const ev of eventsList) {
      const uri = vscode.Uri.from({ scheme: "aid", path: `/scenario/${shortId}/${ev}.js` });
      events.push({ type: vscode.FileChangeType.Changed, uri });
    }
    if (events.length > 0) {
      this._emitter.fire(events);
    }
  }

  /** Drop cached state so the next read hits GraphQL again. */
  public clearSnapshot(shortId: string): void {
    if (!this.snapshots.delete(shortId)) {
      return;
    }
    const events: vscode.FileChangeEvent[] = [];
    for (const ev of ["sharedLibrary", "onInput", "onOutput", "onModelContext"] as ScriptEvent[]) {
      const uri = vscode.Uri.from({ scheme: "aid", path: `/scenario/${shortId}/${ev}.js` });
      events.push({ type: vscode.FileChangeType.Changed, uri });
    }
    if (events.length) {
      this._emitter.fire(events);
    }
  }

  watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
    return new vscode.Disposable(() => { });
  }

  stat(_uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
    return {
      type: vscode.FileType.File,
      ctime: Date.now(),
      mtime: Date.now(),
      size: 0
    };
  }

  readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
    return [];
  }

  async createDirectory(_uri: vscode.Uri): Promise<void> {
    return;
  }

  private isScenarioJsonPath(parts: string[]): boolean {
    if (parts.length < 3) {
      return false;
    }
    // Back-compat old style: /scenario/{id}/scenario.json/(pretty?)
    if (parts[2] === "scenario.json") {
      return true;
    }
    // New flattened style: /scenario/{id}/{Pretty}.json
    if (parts[2].toLowerCase().endsWith(".json")) {
      return true;
    }
    return false;
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    if (uri.scheme !== "aid") {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const parts = uri.path.split("/").filter(Boolean);
    if (parts[0] !== "scenario") {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (parts.length < 3) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const shortId = parts[1];

    if (this.isScenarioJsonPath(parts)) {
      const buf = await this.scenarioJsonReader(shortId);
      return buf;
    }

    const resource = parts[2];
    const event = resource.replace(/\.js$/i, "") as ScriptEvent;
    if (!["sharedLibrary", "onInput", "onOutput", "onModelContext"].includes(event)) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    let snap = this.snapshots.get(shortId);
    if (!snap) {
      const s = await this.client.getScenarioScripting(shortId);
      snap = {
        sharedLibrary: s.gameCodeSharedLibrary ?? null,
        onInput: s.gameCodeOnInput ?? null,
        onOutput: s.gameCodeOnOutput ?? null,
        onModelContext: s.gameCodeOnModelContext ?? null
      };
      this.snapshots.set(shortId, snap);
    }

    const value = (snap as any)[event] ?? "";
    return new TextEncoder().encode(value || "");
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array, _options: { create: boolean; overwrite: boolean }): Promise<void> {
    if (uri.scheme !== "aid") {
      throw vscode.FileSystemError.NoPermissions("Write is only supported on aid: URIs.");
    }

    const parts = uri.path.split("/").filter(Boolean);
    if (parts[0] !== "scenario" || parts.length < 3) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const shortId = parts[1];

    if (this.isScenarioJsonPath(parts)) {
      if (!this.scenarioJsonWriter) {
        vscode.window.showWarningMessage("Remote scenario save is not implemented yet. Use 'Save As' to export locally.");
        throw vscode.FileSystemError.NoPermissions("Remote scenario save not implemented.");
      }
      await this.scenarioJsonWriter(shortId, content);
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }

    const resource = parts[2];
    const event = resource.replace(/\.js$/i, "") as ScriptEvent;
    if (!["sharedLibrary", "onInput", "onOutput", "onModelContext"].includes(event)) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const text = new TextDecoder("utf8").decode(content);
    await this.remoteSave({ scenarioShortId: shortId, event, content: text });

    this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  delete(_uri: vscode.Uri): void | Thenable<void> {
    throw vscode.FileSystemError.NoPermissions("Delete is not supported for aid:");
  }

  rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _opts: { overwrite: boolean }): void | Thenable<void> {
    throw vscode.FileSystemError.NoPermissions("Rename is not supported for aid:");
  }
}
