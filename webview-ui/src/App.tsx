import { useCallback, useEffect, useState } from "react";
import type { ContentRating, HostMessage, ScenarioModel, ScenarioState, StoryCard } from "./types";
import vscode from "./vscode";
import "./App.css";
import { StoryCardList } from "./components/StoryCardList";
import type { StoryCardView } from "./components/StoryCardEditor";

const fmtDate = (value?: string | null) => {
  if (!value) {
    return "—";
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return value;
  }
  return d.toLocaleString();
};

const detailFields: Array<{ label: string; key: keyof ScenarioFields; multiline?: boolean }> = [
  { label: "Title", key: "title" },
  { label: "Description", key: "description", multiline: true }
];

const contentRatingOptions: ContentRating[] = ["Everyone", "Teen", "Mature", "Unrated"];

type ScenarioFields = {
  title: string;
  description: string;
  prompt: string;
  instructions: string;
  storySummary: string;
  memory: string;
  authorsNote: string;
};

const emptyScenarioFields: ScenarioFields = {
  title: "",
  description: "",
  prompt: "",
  instructions: "",
  storySummary: "",
  memory: "",
  authorsNote: ""
};

const toViewModel = (card: StoryCard): StoryCardView => ({
  ...card,
  body: card.value ?? card.body ?? "",
  description: card.description ?? "",
  localId: card.id,
  dirty: false,
  isLocal: false,
  saving: false
});

const mergeStoryCards = (serverCards: StoryCardView[], current: StoryCardView[]): StoryCardView[] => {
  const localPending = current.filter((card) => card.isLocal && !card.saving);
  const merged = [...serverCards];
  const existingIds = new Set(merged.map((card) => card.localId));
  for (const local of localPending) {
    if (!existingIds.has(local.localId)) {
      merged.push(local);
    }
  }
  return merged;
};

const createLocalCard = (): StoryCardView => ({
  id: "",
  localId: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  title: "",
  type: "",
  keys: "",
  body: "",
  description: "",
  useForCharacterCreation: true,
  isLocal: true,
  dirty: true,
  saving: false
});

const extractScenarioFields = (model?: ScenarioModel | null): ScenarioFields => ({
  title: model?.title ?? "",
  description: model?.description ?? "",
  prompt: model?.prompt ?? "",
  instructions: ((model?.state as ScenarioState | undefined)?.instructions?.scenario as string) ?? "",
  storySummary: (model?.state as ScenarioState | undefined)?.storySummary ?? "",
  memory: model?.memory ?? "",
  authorsNote: model?.authorsNote ?? ""
});

const normalizeContentRating = (value?: string | null): ContentRating => {
  if (value === "Everyone" || value === "Teen" || value === "Mature" || value === "Unrated") {
    return value;
  }
  return "Unrated";
};

const extractTags = (model?: ScenarioModel | null): string[] =>
  (model?.tags ?? []).filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0).map((tag) => tag.trim());

const FIELD_LIMITS: Record<keyof ScenarioFields, number> = {
  title: 120,
  description: 2000,
  prompt: 4000,
  instructions: 4000,
  storySummary: 4000,
  memory: 4000,
  authorsNote: 4000
};

export default function App() {
  const [scenario, setScenario] = useState<ScenarioModel | null>(null);
  const [storyCards, setStoryCards] = useState<StoryCardView[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [scenarioFields, setScenarioFields] = useState<ScenarioFields>(emptyScenarioFields);
  const [scenarioBaseline, setScenarioBaseline] = useState<ScenarioFields>(emptyScenarioFields);
  const [tagList, setTagList] = useState<string[]>([]);
  const [tagBaseline, setTagBaseline] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [contentRating, setContentRating] = useState<ContentRating>("Unrated");
  const [contentRatingBaseline, setContentRatingBaseline] = useState<ContentRating>("Unrated");

  const buildScenarioSnapshot = (): ScenarioModel => {
    const base: ScenarioModel = {
      ...(scenario ?? {}),
      title: scenarioFields.title,
      description: scenarioFields.description,
      prompt: scenarioFields.prompt,
      memory: scenarioFields.memory,
      authorsNote: scenarioFields.authorsNote,
      tags: [...tagList],
      contentRating
    };
    const instructions = { ...((base.state?.instructions as Record<string, unknown>) ?? {}) };
    instructions.scenario = scenarioFields.instructions;
    base.state = {
      ...(base.state ?? {}),
      storySummary: scenarioFields.storySummary,
      instructions
    };
    return base;
  };

  const buildStoryCardPayload = () =>
    storyCards.map((card) => ({
      id: card.id,
      title: card.title ?? "",
      type: card.type ?? "",
      keys: card.keys ?? "",
      value: card.body ?? card.value ?? "",
      description: card.description ?? "",
      useForCharacterCreation: !!card.useForCharacterCreation
    }));

  const applyScenarioModel = useCallback((model?: ScenarioModel | null, incomingCards?: StoryCard[]) => {
    setScenario(model ?? null);
    const initialFields = extractScenarioFields(model);
    setScenarioFields(initialFields);
    setScenarioBaseline(initialFields);
    const rating = normalizeContentRating(model?.contentRating ?? null);
    setContentRating(rating);
    setContentRatingBaseline(rating);
    const tags = extractTags(model);
    setTagList(tags);
    setTagBaseline(tags);
    if (incomingCards) {
      const serverCards = incomingCards.map(toViewModel);
      setStoryCards((prev) => mergeStoryCards(serverCards, prev));
    }
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<HostMessage>) => {
      const msg = event.data;
      if (!msg?.type) {
        return;
      }
      switch (msg.type) {
        case "scenario:init": {
          applyScenarioModel(msg.model ?? null, msg.storyCards ?? []);
          setIsSaving(false);
          setSaveError(null);
          break;
        }
        case "scenario:saved": {
          applyScenarioModel(msg.model ?? null, msg.storyCards ?? []);
          setIsSaving(false);
          setSaveError(null);
          break;
        }
        case "scenario:save:error": {
          setIsSaving(false);
          setSaveError(msg.message ?? "Failed to save scenario.");
          break;
        }
          case "storyCards:set": {
            const serverCards = (msg.storyCards ?? []).map(toViewModel);
            setStoryCards((prev) => mergeStoryCards(serverCards, prev));
            break;
          }
        case "scenario:requestState": {
          vscode.postMessage({
            type: "scenario:state",
            requestId: msg.requestId,
            payload: {
              model: buildScenarioSnapshot(),
              storyCards: buildStoryCardPayload()
            }
          });
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "scenario:ready" });
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const scenarioDirty = JSON.stringify(scenarioFields) !== JSON.stringify(scenarioBaseline);
  const tagsDirty = JSON.stringify(tagList) !== JSON.stringify(tagBaseline);
  const cardDirty = storyCards.some((card) => card.dirty && !card.saving);
  const ratingDirty = contentRating !== contentRatingBaseline;
  const hasUnsavedChanges = scenarioDirty || tagsDirty || cardDirty || ratingDirty;

  useEffect(() => {
    vscode.postMessage({ type: "scenario:dirty", dirty: hasUnsavedChanges });
  }, [hasUnsavedChanges]);

  const handleScenarioFieldChange = (field: keyof ScenarioFields, value: string) => {
    setScenarioFields((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddTag = () => {
    const next = newTag.trim();
    if (!next) {
      return;
    }
    if (tagList.includes(next)) {
      setNewTag("");
      return;
    }
    setTagList((prev) => [...prev, next]);
    setNewTag("");
  };

  const handleRemoveTag = (index: number) => {
    setTagList((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleContentRatingChange = (value: string) => {
    setContentRating(normalizeContentRating(value));
  };

  const handleStoryCardChange = (localId: string, field: keyof StoryCard, value: string) => {
    setStoryCards((prev) => prev.map((card) => {
      if (card.localId !== localId) {
        return card;
      }
      const next: StoryCardView = { ...card, [field]: value };
      if (field === "body") {
        next.value = value;
      }
      if (field === "description") {
        next.description = value;
      }
      next.dirty = true;
      return next;
    }));
  };

  const handleStoryCardDelete = (card: StoryCardView) => {
    if (!card.id) {
      setStoryCards((prev) => prev.filter((c) => c.localId !== card.localId));
      return;
    }
    setStoryCards((prev) => prev.map((c) => (c.localId === card.localId ? { ...c, saving: true, dirty: false } : c)));
    vscode.postMessage({ type: "storycard:delete", id: card.id });
  };

  const handleStoryCardCreate = () => {
    setStoryCards((prev) => [createLocalCard(), ...prev]);
  };

  const handleStoryCardSave = (card: StoryCardView) => {
    setStoryCards((prev) => prev.map((c) => (c.localId === card.localId ? { ...c, saving: true } : c)));
    const payload = {
      title: card.title ?? "",
      type: card.type ?? "card",
      keys: card.keys ?? "",
      body: card.body ?? "",
      description: card.description ?? "",
      useForCharacterCreation: card.useForCharacterCreation ?? true
    };

    if (!card.id || card.isLocal) {
      vscode.postMessage({
        type: "storycard:create",
        payload
      });
      return;
    }

    vscode.postMessage({
      type: "storycard:update",
      id: card.id,
      patch: {
        title: payload.title,
        type: payload.type,
        keys: payload.keys,
        value: payload.body,
        description: payload.description,
        useForCharacterCreation: payload.useForCharacterCreation
      }
    });
  };

  const handleScenarioSave = () => {
    if (!hasUnsavedChanges || isSaving) {
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    vscode.postMessage({
      type: "scenario:save",
      payload: {
        model: buildScenarioSnapshot(),
        storyCards: buildStoryCardPayload()
      }
    });
  };

  if (!scenario) {
    return (
      <div className="app">
        <div className="empty-state">
          <h2>Waiting for scenario…</h2>
          <p>Open a scenario from the tree view to load its details.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-title">
          <span className="eyebrow">Scenario</span>
          <h1>{scenario.title || scenario.shortId}</h1>
        </div>
        <div className="header-controls">
          <div className="chips">
            <span className="chip">ID: {scenario.id ?? "—"}</span>
            <span className="chip">Short ID: {scenario.shortId ?? "—"}</span>
            <span className="chip">Public ID: {scenario.publicId ?? "—"}</span>
          </div>
          <div className="save-controls">
            <button
              className="btn"
              onClick={handleScenarioSave}
              disabled={!hasUnsavedChanges || isSaving}
            >
              {isSaving ? "Saving…" : "Save Changes"}
            </button>
            <span className={`status ${hasUnsavedChanges ? "dirty" : ""}`}>
              {isSaving ? "Saving…" : hasUnsavedChanges ? "Unsaved changes" : "Saved"}
            </span>
          </div>
          {saveError && <p className="input-error">{saveError}</p>}
        </div>
      </header>

      <main className="content">
        <section className="card">
          <h2 className="section-title">Details</h2>
          <div className="details-grid">
            {detailFields.map(({ label, key, multiline }) => {
              const limit = FIELD_LIMITS[key];
              const value = scenarioFields[key] ?? "";
              return (
                <label key={key} className="field">
                  <span>{label}</span>
                  {multiline ? (
                    <>
                      <textarea
                        value={value}
                        onChange={(e) => handleScenarioFieldChange(key, e.target.value)}
                        className="input textarea"
                        maxLength={limit}
                      />
                      <p className="muted small">{value.length} / {limit}</p>
                    </>
                  ) : (
                    <>
                      <input
                        value={value}
                        onChange={(e) => handleScenarioFieldChange(key, e.target.value)}
                        className="input"
                        maxLength={limit}
                      />
                      <p className="muted small">{value.length} / {limit}</p>
                    </>
                  )}
                </label>
              );
            })}
            <label className="field">
              <span>Tags</span>
              <div className="tags-editor">
                {tagList.length === 0 && <span className="muted">No tags</span>}
                {tagList.map((tag, index) => (
                  <span key={`${tag}-${index}`} className="tag chip editable">
                    {tag}
                    <button
                      type="button"
                      className="tag-remove"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleRemoveTag(index);
                      }}
                      aria-label={`Remove ${tag}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <div className="tag-input-group">
                  <input
                    className="input tag-input"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddTag();
                      }
                    }}
                    placeholder="Add tag"
                  />
                  <button className="btn" type="button" onClick={handleAddTag}>Add</button>
                </div>
              </div>
            </label>
            <div className="meta-row">
              <div>
                <span className="muted">Created</span>
                <div>{fmtDate(scenario.createdAt)}</div>
              </div>
              <div>
                <span className="muted">Edited</span>
                <div>{fmtDate(scenario.editedAt)}</div>
              </div>
              <div>
                <span className="muted">Content Rating</span>
                <select
                  className="input"
                  value={contentRating}
                  onChange={(e) => handleContentRatingChange(e.target.value)}
                >
                  {contentRatingOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="section-heading">
            <span className="title">Opening</span>
            <span className="subtitle">Story</span>
          </div>
          <textarea
            className="input textarea"
            value={scenarioFields.prompt}
            onChange={(e) => handleScenarioFieldChange("prompt", e.target.value)}
            placeholder="It starts here..."
            maxLength={FIELD_LIMITS.prompt}
          />
          <p className="muted small">{scenarioFields.prompt.length} / {FIELD_LIMITS.prompt}</p>
        </section>

        <section className="card">
          <h2 className="section-title">AI Instructions</h2>
          <textarea
            className="input textarea"
            value={scenarioFields.instructions}
            onChange={(e) => handleScenarioFieldChange("instructions", e.target.value)}
            placeholder="Describe how the AI should narrate..."
            maxLength={FIELD_LIMITS.instructions}
          />
          <p className="muted small">{scenarioFields.instructions.length} / {FIELD_LIMITS.instructions}</p>
        </section>

        <section className="card">
          <h2 className="section-title">Story Summary</h2>
          <textarea
            className="input textarea"
            value={scenarioFields.storySummary}
            onChange={(e) => handleScenarioFieldChange("storySummary", e.target.value)}
            placeholder="Summarize the plot..."
            maxLength={FIELD_LIMITS.storySummary}
          />
          <p className="muted small">{scenarioFields.storySummary.length} / {FIELD_LIMITS.storySummary}</p>
        </section>

        <section className="card">
          <h2 className="section-title">Plot Essentials</h2>
          <textarea
            className="input textarea"
            value={scenarioFields.memory}
            onChange={(e) => handleScenarioFieldChange("memory", e.target.value)}
            placeholder="Key facts the AI must remember..."
            maxLength={FIELD_LIMITS.memory}
          />
          <p className="muted small">{scenarioFields.memory.length} / {FIELD_LIMITS.memory}</p>
        </section>

        <section className="card">
          <h2 className="section-title">Author's Note</h2>
          <textarea
            className="input textarea"
            value={scenarioFields.authorsNote}
            onChange={(e) => handleScenarioFieldChange("authorsNote", e.target.value)}
            placeholder="Additional guidance..."
            maxLength={FIELD_LIMITS.authorsNote}
          />
          <p className="muted small">{scenarioFields.authorsNote.length} / {FIELD_LIMITS.authorsNote}</p>
        </section>

        <StoryCardList
          storyCards={storyCards}
          onCreate={handleStoryCardCreate}
          onChange={handleStoryCardChange}
          onSave={handleStoryCardSave}
          onDelete={handleStoryCardDelete}
        />
      </main>
    </div>
  );
}
