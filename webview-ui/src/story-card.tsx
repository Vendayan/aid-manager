import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./App.css";
import "./index.css";
import type { StoryCard } from "./types";
import { StoryCardEditor } from "./components/StoryCardEditor";

declare const acquireVsCodeApi: () => { postMessage(msg: any): void };

type Incoming =
  | { type: "storyCard:set"; card: StoryCard }
  | { type: "storyCard:deleted" }
  | { type: "storyCard:error"; message?: string };

function StandaloneStoryCard() {
  const vscode = useMemo(() => {
    try {
      return acquireVsCodeApi();
    } catch {
      return { postMessage: (_msg: any) => { /* noop */ } };
    }
  }, []);

  const [dirtyCard, setDirtyCard] = useState<StoryCard | null>(null);

  useEffect(() => {
    const handler = (ev: MessageEvent<Incoming>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "storyCard:set") {
        setDirtyCard(msg.card);
      }
      if (msg.type === "storyCard:deleted") {
        setDirtyCard(null);
      }
      if (msg.type === "storyCard:error") {
        alert(msg.message || "Story card error");
      }
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "storyCard:ready" });
    return () => window.removeEventListener("message", handler);
  }, [vscode]);

  const onChange = (_localId: string, field: keyof StoryCard, value: string) => {
    if (!dirtyCard) return;
    setDirtyCard({ ...dirtyCard, [field]: value });
  };

  const onSave = () => {
    if (!dirtyCard) return;
    vscode.postMessage({ type: "storyCard:update", patch: dirtyCard });
  };

  const onDelete = () => {
    vscode.postMessage({ type: "storyCard:delete" });
  };

  const shellStyle: React.CSSProperties = {
    padding: 12,
    maxWidth: 960,
    margin: "0 auto",
    width: "100%"
  };

  if (!dirtyCard) {
    return (
      <div style={shellStyle}>
        <p className="muted">Loading story card…</p>
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      <StoryCardEditor
        card={{ ...dirtyCard, localId: dirtyCard.id || "card", dirty: true }}
        onChange={(lid, field, value) => onChange(lid, field, value)}
        onSave={() => onSave()}
        onDelete={() => onDelete()}
      />
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<StandaloneStoryCard />);
}
