export type Scenario = {
  id: string;
  shortId: string;
  parentId?: string;
  title: string;
  description: string;
  image: string;
  tags: string[];
  createdAt?: Date;
};

export type ScriptEvent = "sharedLibrary" | "onInput" | "onOutput" | "onModelContext";
export const FIELD_BY_EVENT: Record<ScriptEvent, string> = {
  sharedLibrary: "gameCodeSharedLibrary",
  onInput: "gameCodeOnInput",
  onOutput: "gameCodeOnOutput",
  onModelContext: "gameCodeOnModelContext",
};

export type Script = {
  scenarioShortId: string;
  scenarioName: string;
  name: string;
  event: ScriptEvent;
  content?: string;
  fieldId?: string;
};
