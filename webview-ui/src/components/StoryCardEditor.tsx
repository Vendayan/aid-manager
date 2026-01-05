import { useCallback } from "react";
import type { ChangeEvent } from "react";
import type { StoryCard } from "../types";

export type StoryCardView = StoryCard & {
  localId: string;
  isLocal?: boolean;
  dirty?: boolean;
  saving?: boolean;
};

type Props = {
  card: StoryCardView;
  onChange: (localId: string, field: keyof StoryCard, value: string) => void;
  onSave: (card: StoryCardView) => void;
  onDelete: (card: StoryCardView) => void;
};

const STORY_CARD_CHAR_LIMIT = 2000;

export function StoryCardEditor({ card, onChange, onSave, onDelete }: Props) {
  const handleChange = useCallback(
    (field: keyof StoryCard) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(card.localId, field, event.target.value);
    },
    [card.localId, onChange]
  );

  return (
    <div className="storycard">
      <div className="storycard-header">
        <strong>{card.title || "Untitled"}</strong>
        <div className="storycard-actions">
          {card.dirty && !card.saving && (
            <button className="btn" onClick={() => onSave(card)}>Save</button>
          )}
          <button className="btn ghost" onClick={() => onDelete(card)}>Delete</button>
        </div>
      </div>
      <p className="muted small">
        {card.useForCharacterCreation ? "Used for character creation" : "Not used for character creation"}
      </p>
      {card.saving && <p className="muted small">Saving…</p>}
      <label className="field">
        <span>Title</span>
        <input
          value={card.title ?? ""}
          onChange={handleChange("title")}
          className="input"
        />
      </label>
      <div className="storycard-row">
        <label className="field">
          <span>Type</span>
          <input
            value={card.type ?? ""}
            onChange={handleChange("type")}
            className="input"
          />
        </label>
        <label className="field">
          <span>Keys</span>
          <input
            value={card.keys ?? ""}
            onChange={handleChange("keys")}
            className="input"
          />
        </label>
      </div>
      <label className="field">
        <span>Entry</span>
        <textarea
          value={card.body ?? ""}
          onChange={handleChange("body")}
          className="input textarea"
          maxLength={STORY_CARD_CHAR_LIMIT}
        />
        <p className="muted small">{(card.body ?? "").length} / {STORY_CARD_CHAR_LIMIT}</p>
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea
          value={card.description ?? ""}
          onChange={handleChange("description")}
          className="input textarea"
          maxLength={STORY_CARD_CHAR_LIMIT}
        />
        <p className="muted small">{(card.description ?? "").length} / {STORY_CARD_CHAR_LIMIT}</p>
      </label>
    </div>
  );
}
