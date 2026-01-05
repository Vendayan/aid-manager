import * as vscode from "vscode";
import { ScriptEvent } from "./AIDTypes";

export type ScenarioSnapshot = {
  sharedLibrary: string | null;
  onInput: string | null;
  onOutput: string | null;
  onModelContext: string | null;
};

function emptySnap(): ScenarioSnapshot {
  return { sharedLibrary: null, onInput: null, onOutput: null, onModelContext: null };
}

function valueOf(s: ScenarioSnapshot | undefined, ev: ScriptEvent): string | null | undefined {
  if (!s) {
    return null;
  }
  if (ev === "sharedLibrary") {
    return s.sharedLibrary;
  }
  if (ev === "onInput") {
    return s.onInput;
  }
  if (ev === "onOutput") {
    return s.onOutput;
  }
  if (ev === "onModelContext") {
    return s.onModelContext;
  }
  return null;
}

/**
 * Centralized in-memory store for:
 *  - Last known server snapshot per scenario
 *  - Local "exists/missing" overrides per script event
 *  - Force-reload flags
 *
 * Emits onDidChange(shortId) when a scenario branch should re-render.
 */
export class LocalStore {
  private snaps = new Map<string, ScenarioSnapshot>();
  private overrides = new Map<string, Map<ScriptEvent, "exists" | "missing">>();
  private forceReload = new Set<string>();
  private emitter = new vscode.EventEmitter<string | undefined>();
  readonly onDidChange = this.emitter.event;

  setSnapshot(shortId: string, snap: Partial<ScenarioSnapshot>): void {
    const cur = this.snaps.get(shortId) ?? emptySnap();
    this.snaps.set(shortId, { ...cur, ...snap });
    this.emitter.fire(shortId);
  }

  getSnapshot(shortId: string): ScenarioSnapshot | undefined {
    return this.snaps.get(shortId);
  }

  clearSnapshot(shortId: string): void {
    this.snaps.delete(shortId);
    this.emitter.fire(shortId);
  }

  setOverride(shortId: string, ev: ScriptEvent, state: "exists" | "missing"): void {
    let m = this.overrides.get(shortId);
    if (!m) {
      m = new Map();
      this.overrides.set(shortId, m);
    }
    m.set(ev, state);
    this.emitter.fire(shortId);
  }

  clearOverrides(shortId: string): void {
    this.overrides.delete(shortId);
    this.emitter.fire(shortId);
  }

  overrideFor(shortId: string, ev: ScriptEvent): "exists" | "missing" | undefined {
    return this.overrides.get(shortId)?.get(ev);
  }

  effectiveExists(shortId: string, ev: ScriptEvent): boolean {
    const o = this.overrideFor(shortId, ev);
    if (o) {
      return o === "exists";
    }
    const v = valueOf(this.snaps.get(shortId), ev);
    return typeof v === "string" && v.trim().length > 0;
  }

  requestServerReload(shortId: string): void {
    this.forceReload.add(shortId);
    this.emitter.fire(shortId);
  }

  consumeServerReload(shortId: string): boolean {
    if (this.forceReload.has(shortId)) {
      this.forceReload.delete(shortId);
      return true;
    }
    return false;
  }

  requestLocalRefresh(shortId: string): void {
    this.emitter.fire(shortId);
  }

  resetAll(): void {
    this.snaps.clear();
    this.overrides.clear();
    this.forceReload.clear();
    this.emitter.fire(undefined);
  }
}
