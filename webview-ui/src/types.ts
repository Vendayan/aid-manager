export type ContentRating = "Everyone" | "Teen" | "Mature" | "Unrated";

export type ScenarioModel = {
  id?: string;
  shortId?: string;
  publicId?: string | null;
  title?: string;
  description?: string;
  prompt?: string;
  memory?: string;
  authorsNote?: string;
  tags?: string[];
  createdAt?: string | null;
  editedAt?: string | null;
  contentRating?: ContentRating | null;
  state?: ScenarioState;
};

export type ScenarioState = {
  storySummary?: string;
  storyCardInstructions?: string;
  storyCardStoryInformation?: string;
  instructions?: Record<string, unknown>;
  scenarioStateVersion?: number | null;
};

export type StoryCard = {
  id: string;
  title?: string;
  type?: string;
  keys?: string;
  body?: string;
  value?: string;
  description?: string;
  useForCharacterCreation?: boolean;
};

export type HostMessage =
  | {
      type: "scenario:init";
      model?: ScenarioModel | null;
      plotComponents?: Record<string, { type: string; text: string }>;
      storyCards?: StoryCard[];
    }
  | {
      type: "scenario:saved";
      model?: ScenarioModel | null;
      storyCards?: StoryCard[];
    }
  | {
      type: "scenario:save:error";
      message?: string;
    }
  | {
      type: "storyCards:set";
      storyCards?: StoryCard[];
    }
  | {
      type: "storyCard:set";
      card: StoryCard;
    }
  | {
      type: "storyCard:deleted";
    }
  | {
      type: "storyCard:error";
      message?: string;
    }
  | {
      type: "scenario:requestState";
      requestId: string;
    };
