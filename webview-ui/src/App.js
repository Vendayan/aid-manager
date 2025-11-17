import { useEffect, useMemo, useRef, useState } from "react";
import vscode from "./vscode";
import "./App.css";
const debounceDelay = 400;
const fmtDate = (value) => {
    if (!value) {
        return "—";
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
        return value;
    }
    return d.toLocaleString();
};
const scenarioFields = [
    { label: "Title", key: "title" },
    { label: "Prompt", key: "prompt", multiline: true },
    { label: "Memory", key: "memory", multiline: true },
    { label: "Author's Note", key: "authorsNote", multiline: true },
    { label: "Description", key: "description", multiline: true }
];
export default function App() {
    const [scenario, setScenario] = useState(null);
    const [storyCards, setStoryCards] = useState([]);
    const [plotComponents, setPlotComponents] = useState({});
    const debouncers = useRef(new Map());
    useEffect(() => {
        const handleMessage = (event) => {
            const msg = event.data;
            if (!msg?.type) {
                return;
            }
            switch (msg.type) {
                case "scenario:init":
                    setScenario(msg.model ?? null);
                    setStoryCards(msg.storyCards ?? []);
                    setPlotComponents(msg.plotComponents ?? {});
                    break;
                case "storyCards:set":
                    setStoryCards(msg.storyCards ?? []);
                    break;
                default:
                    break;
            }
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);
    const tags = useMemo(() => {
        return (scenario?.tags ?? []).filter(Boolean).map((tag) => String(tag));
    }, [scenario?.tags]);
    const handleStoryCardChange = (id, field, value) => {
        setStoryCards((prev) => prev.map((card) => (card.id === id ? { ...card, [field]: value } : card)));
        const patch = { [field]: value };
        const existing = debouncers.current.get(id);
        if (existing) {
            window.clearTimeout(existing);
        }
        const timeout = window.setTimeout(() => {
            vscode.postMessage({ type: "storycard:update", id, patch });
            debouncers.current.delete(id);
        }, debounceDelay);
        debouncers.current.set(id, timeout);
    };
    const handleStoryCardDelete = (id) => {
        vscode.postMessage({ type: "storycard:delete", id });
    };
    const handleStoryCardCreate = () => {
        vscode.postMessage({ type: "storycard:create" });
    };
    const handleStoryCardFocus = (id) => {
        vscode.postMessage({ type: "storycard:focus", id });
    };
    if (!scenario) {
        return (<div className="app">
        <div className="empty-state">
          <h2>Waiting for scenario…</h2>
          <p>Open a scenario from the tree view to load its details.</p>
        </div>
      </div>);
    }
    const plotEntries = Object.values(plotComponents ?? {});
    return (<div className="app">
      <header className="app-header">
        <div>
          <span className="eyebrow">Scenario</span>
          <h1>{scenario.title || scenario.shortId}</h1>
        </div>
        <div className="chips">
          <span className="chip">ID: {scenario.id ?? "—"}</span>
          <span className="chip">Short ID: {scenario.shortId ?? "—"}</span>
          <span className="chip">Public ID: {scenario.publicId ?? "—"}</span>
        </div>
      </header>

      <main className="content">
        <section className="card">
          <h2 className="section-title">Details</h2>
          <div className="details-grid">
            {scenarioFields.map(({ label, key, multiline }) => (<label key={key} className="field">
                <span>{label}</span>
                {multiline ? (<textarea value={scenario?.[key] ?? ""} readOnly className="input textarea"/>) : (<input value={scenario?.[key] ?? ""} readOnly className="input"/>)}
              </label>))}
            <label className="field">
              <span>Tags</span>
              <div className="tag-list">
                {tags.length === 0 ? <span className="muted">No tags</span> : tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}
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
                <div>{scenario.contentRating ?? "Unrated"}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <header className="section-header">
            <h2 className="section-title">Story Cards</h2>
            <button className="btn" onClick={handleStoryCardCreate}>New Card</button>
          </header>
          {storyCards.length === 0 && <p className="muted">No story cards yet.</p>}
          <div className="storycard-grid">
            {storyCards.map((card) => (<div key={card.id} className="storycard">
                <div className="storycard-header">
                  <strong>{card.title || "Untitled"}</strong>
                  <div className="storycard-actions">
                    <button className="btn ghost" onClick={() => handleStoryCardFocus(card.id)}>Focus</button>
                    <button className="btn ghost" onClick={() => handleStoryCardDelete(card.id)}>Delete</button>
                  </div>
                </div>
                <label className="field">
                  <span>Title</span>
                  <input value={card.title ?? ""} onChange={(e) => handleStoryCardChange(card.id, "title", e.target.value)} className="input"/>
                </label>
                <div className="storycard-row">
                  <label className="field">
                    <span>Type</span>
                    <input value={card.type ?? ""} onChange={(e) => handleStoryCardChange(card.id, "type", e.target.value)} className="input"/>
                  </label>
                  <label className="field">
                    <span>Keys</span>
                    <input value={card.keys ?? ""} onChange={(e) => handleStoryCardChange(card.id, "keys", e.target.value)} className="input"/>
                  </label>
                </div>
                <label className="field">
                  <span>Body</span>
                  <textarea value={card.body ?? ""} onChange={(e) => handleStoryCardChange(card.id, "body", e.target.value)} className="input textarea"/>
                </label>
              </div>))}
          </div>
        </section>

        <section className="card">
          <h2 className="section-title">Plot Components</h2>
          {plotEntries.length === 0 ? (<p className="muted">No plot components reported.</p>) : (<div className="plot-grid">
              {plotEntries.map((pc) => (<article key={pc.type} className="plot-card">
                  <h3>{pc.type}</h3>
                  <p>{pc.text || "—"}</p>
                </article>))}
            </div>)}
        </section>
      </main>
    </div>);
}
//# sourceMappingURL=App.js.map