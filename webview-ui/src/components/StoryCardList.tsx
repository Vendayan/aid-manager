import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { StoryCard } from "../types";
import { StoryCardEditor, type StoryCardView } from "./StoryCardEditor";

type Props = {
  storyCards: StoryCardView[];
  onCreate: () => void;
  onChange: (localId: string, field: keyof StoryCard, value: string) => void;
  onSave: (card: StoryCardView) => void;
  onDelete: (card: StoryCardView) => void;
};

type FilterResult = { cards: StoryCardView[]; error: string | null };

const LIST_MIN_HEIGHT = 240;
const LIST_MAX_HEIGHT = 620;

const filterCards = (cards: StoryCardView[], search: string, useRegex: boolean): FilterResult => {
  const query = search.trim();
  if (!query) {
    return { cards, error: null };
  }
  if (useRegex) {
    try {
      const regex = new RegExp(query, "i");
      return {
        cards: cards.filter((card) => regex.test(card.title ?? "") || regex.test(card.keys ?? "")),
        error: null
      };
    } catch (err: any) {
      return { cards: [], error: err?.message ?? String(err) };
    }
  }
  const needle = query.toLowerCase();
  const matches = cards.filter((card) => {
    const title = (card.title ?? "").toLowerCase();
    const keys = (card.keys ?? "").toLowerCase();
    return title.startsWith(needle) || keys.startsWith(needle);
  });
  return { cards: matches, error: null };
};

export function StoryCardList({ storyCards, onCreate, onChange, onSave, onDelete }: Props) {
  const [searchText, setSearchText] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const { cards: filteredCards, error: filterError } = useMemo(
    () => filterCards(storyCards, searchText, useRegex),
    [storyCards, searchText, useRegex]
  );

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const [listWidth, setListWidth] = useState(0);

  useLayoutEffect(() => {
    const node = listContainerRef.current;
    if (!node) {
      return;
    }
    const measure = () => {
      setListWidth(node.getBoundingClientRect().width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const listHeight =
    filteredCards.length === 0
      ? 0
      : Math.min(LIST_MAX_HEIGHT, Math.max(LIST_MIN_HEIGHT, filteredCards.length * 260));

  const noCards = storyCards.length === 0;
  const noMatches = !noCards && filteredCards.length === 0 && !filterError;

  return (
    <section className="card">
      <header className="section-header">
        <h2 className="section-title">Story Cards</h2>
        <button className="btn" onClick={onCreate}>New Card</button>
      </header>

      <div className="storycard-toolbar">
        <div className="storycard-search">
          <div className="search-input-row">
            <input
              className="input"
              placeholder="Search title or keys"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            <label className="checkbox inline">
              <input
                type="checkbox"
                checked={useRegex}
                onChange={(e) => setUseRegex(e.target.checked)}
              />
              Use regex
            </label>
          </div>
        </div>
        <span className="muted small">
          Showing {filteredCards.length} / {storyCards.length}
        </span>
      </div>
      {filterError && <p className="input-error">Invalid regex: {filterError}</p>}
      {noCards && <p className="muted">No story cards yet.</p>}
      {noMatches && <p className="muted">No cards match the current filter.</p>}

      <div className="storycard-virtual-container" ref={listContainerRef}>
        {filteredCards.length > 0 && listWidth > 0 && listHeight > 0 && (
          <Virtuoso
            style={{ height: listHeight, width: listWidth }}
            data={filteredCards}
            overscan={200}
            itemContent={(_index, card) => (
              <div style={{ paddingBottom: "1rem" }}>
                <StoryCardEditor
                  card={card}
                  onChange={onChange}
                  onSave={onSave}
                  onDelete={onDelete}
                />
              </div>
            )}
          />
        )}
      </div>
    </section>
  );
}
