/// <reference no-default-lib="true"/>
/// <reference lib="es2022"/>

/**
 * Scripting API: https://help.aidungeon.com/scripting
 *
 * Scripting Guidebook: https://github.com/magicoflolis/aidungeon.js/blob/main/Scripting%20Guidebook.md
 */
export type LibraryAPI = unknown;

// #region Global
declare global {
  // #region Typings
  /**
   * This is [Plot Essentials](https://help.aidungeon.com/faq/plot-essentials)
   */
  type plotEssentials = string;
  interface thirdPerson {
    text: string;
    visibleTo?: Info['characters'];
  }
  interface History {
    /**
     * the text of the action
     */
    text: string;
    /**
     * the type of the action, the most common types are listed below
     * - `start` - the first action of an adventure
     * - `continue` - an action created by the AI
     * - `do` - a do action submitted by a player
     * - `say` - a say action submitted by a player
     * - `story` - a story action submitted by a player
     * - `see` - a see action submitted by a player
     */
    type: 'start' | 'continue' | 'do' | 'say' | 'story' | 'see' | 'repeat' | 'unknown';
    /**
     * @deprecated use {@link History.text} instead.
     */
    rawText?: string;
  }
  interface StoryCard {
    /**
     * Usually a number represented as a string:
     * - `"1" === 1` => **false**
     * - `"1" === "1"` => **true**
     * - `Number("1") === 1` => **true**
     */
    id: string;
    /**
     * This is `NAME` in `DETAILS` section of a story card.
     */
    title: string;
    /**
     * This is `TRIGGERS` in `DETAILS` section of a story card.
     */
    keys: string;
    /**
     * This is `TYPE` in `DETAILS` section of a story card.
     */
    type: string;
    /**
     * This is `value` when exported through `Story Card Management`.
     */
    entry: string;
    /**
     * This is `NOTES` in `DETAILS` section of a story card.
     */
    description: string;
    /**
     * Defined after creating a StoryCard using {@link addStoryCard}.
     */
    createdAt: string;
    /**
     * Defined after creating a StoryCard using {@link addStoryCard}.
     */
    updatedAt: string;
    /**
     * Defined after creating a StoryCard using {@link addStoryCard}.
     */
    useForCharacterCreation: boolean;
  }
  interface StateMemory {
    /**
     * This is [Plot Essentials](https://help.aidungeon.com/faq/plot-essentials), added to the beginning of the context, before the history. Corresponds to the Memory available in the UI.
     */
    context?: plotEssentials;
    /**
     * This is [Author's Note](https://help.aidungeon.com/faq/what-is-the-authors-note), added close to the end of the context, immediately before the most recent AI response.
     */
    authorsNote?: string;
    /**
     * Added to the very end of the context, after the most recent player input.
     */
    frontMemory?: string;
  }
  interface State {
    /**
     * This is **creator**-defined memory, has priority over `UserMemory`. Changes made to `state.memory` during `onOutput` won't take affect until the next player action.
     */
    memory: StateMemory & { [key: string]: unknown };
    /**
     * This field is a string which will be shown to the user.
     */
    message: string | thirdPerson | thirdPerson[];
  }
  interface Info {
    /**
     * Number of actions in the adventure so far.
     *
     * Here's how and when info.actionCount increments:
     * - During a **Continue** action: `+1 → onContext → onOutput`
     * - During a **Do/Say/Story** action: `+1 → onInput → +1 → onContext → onOutput`
     * - During a single **Retry** followed by a **Continue**: `+1 → onContext → onOutput → -1 → +1 → onContext → onOutput`
     *
     * _Notice how a Retry increments during the first turn yet inhibits the next turn's +1 increment? This is useful to know!_
     */
    actionCount: number;
    /**
     * Array of the character names for multiplayer adventures.
     */
    characters: Array<string | { name: string }>;
    /**
     * Estimated maximum number of characters that can be included in the model context (character per token can vary).
     *
     * The maximum length that text can be. The server will truncate the text you return to this length.
     *
     * **When available => `onModelContext` | `Context`**
     */
    maxChars?: number;
    /**
     * Number of characters included in the model context from the memory.
     *
     * **When available => `onModelContext` | `Context`**
     * @deprecated use {@link Info.maxChars} instead.
     */
    memoryLength?: number;
    /**
     * Number of context tokens available.
     *
     * **When available => `onModelContext` | `Context`**
     */
    contextTokens?: number;
  }
  // #endregion
  /**
   * ---
   *
   * Create a new {@link StoryCard} and returns the new length of storyCards array.
   *
   * If there is already an existing card with the same keys, returns false.
   *
   * `addWorldEntry` also works for backwards compatibility, but is deprecated.
   *
   * ---
   *
   * _Examples:_
   *
   * ```js
   * log(addStoryCard("Superman", "a bird")); // Returns new length of the `storyCards` array.
   *
   * // Find and create Story Cards
   * function getStoryCard(keys, entry, type = 'Custom') {
   * // Find Story Card based `keys`, `entry`, `type`
   * const card = storyCards.find(({keys: k, entry: e, title: t, type: ty}) => e === entry && ty === type && (k === keys || t === keys));
   * // If `card` exists, return { index, card }
   * if (card) return { index: storyCards.indexOf(card), card };
   * // Otherwise, call `addStoryCard()` function and loop
   * addStoryCard(keys, entry, type);
   * return getStoryCard(keys, entry, type);
   * };
   *
   * // Returns { index: StoryCard[keyof StoryCard], card: StoryCard }
   * log(getStoryCard("Quack", "a duck", "Animal"));
   * ```
   *
   * ---
   *
   * @global
   * @param keys - This will set {@link StoryCard.keys} __and__ {@link StoryCard.title} if undefined.
   * @param entry - This will set {@link StoryCard.entry}.
   * @param type - This will set {@link StoryCard.type}.
   * @param title - This will set {@link StoryCard.title}.
   * @param description - This will set {@link StoryCard.description}.
   * @returns The new length of the {@link storyCards} array.
   */
  function addStoryCard<
    K extends string,
    E extends string,
    T extends string | 'Custom',
    Title extends K,
    D extends string
  >(keys?: K, entry?: E, type?: T, title?: Title, description?: D): number;
  /**
   * @deprecated use {@link addStoryCard} instead.
   */
  function addWorldEntry<K extends string, E extends string, T extends string | 'Custom'>(
    keys?: K,
    entry?: E,
    type?: T
  ): number;
  /**
   * ---
   *
   * Updates a {@link StoryCard}
   *
   * If card does not exist, throws an {@link Error}
   *
   * `updateWorldEntry` also works for backwards compatibility, but is deprecated.
   *
   * ---
   *
   * _Example(s):_
   *
   * ```js
   * let entry = "Eleanor Rigby";
   * let keys = "A old British women from the Victorian era.";
   * let type = "character";
   * const { index } = getStoryCard(keys, entry, type);
   * entry = "Jude";
   * keys = "A young boy from the Victorian era.";
   * type = "Custom";
   *
   * updateStoryCard(index, keys, entry, type);
   * ```
   *
   * @see {@link addStoryCard} for further information on `getStoryCard()` function.
   *
   * ---
   *
   * @global
   * @param index - {@link StoryCard} index number
   * @param keys - {@link StoryCard.keys}
   * @param entry - {@link StoryCard.entry}
   * @param type - {@link StoryCard.type}
   */
  function updateStoryCard<
    I extends string | number,
    K extends string,
    E extends string,
    T extends string
  >(index: I, keys: K, entry: E, type: T): void;
  /**
   * @deprecated use {@link updateStoryCard} instead.
   */
  function updateWorldEntry<
    I extends string | number,
    K extends string,
    E extends string,
    T extends string
  >(index: I, keys: K, entry: E, type: T): void;
  /**
   * ---
   *
   * Remove {@link StoryCard}
   *
   * If card does not exist, throws an {@link Error}
   *
   * `removeWorldEntry` also works for backwards compatibility, but it is deprecated
   *
   * ---
   *
   * _Example(s):_
   *
   * ```js
   * const entry = "Eleanor Rigby";
   * const keys = "A old British women from the Victorian era.";
   * const type = "character";
   * const { index } = getStoryCard(keys, entry, type);
   *
   * removeStoryCard(index);
   * ```
   *
   * @see {@link addStoryCard} for further information on `getStoryCard()` function.
   *
   * ---
   *
   * @global
   * @param index - {@link StoryCard} index number.
   */
  function removeStoryCard<I extends string | number>(index: I): void;
  /**
   * @deprecated use {@link removeStoryCard} instead.
   */
  function removeWorldEntry<I extends string | number>(index: I): void;
  /**
   * Logs information to the console.
   *
   * `console.log` also works to reduce confusion.
   *
   * `sandboxConsole.log` also works for backward compatibility, but is deprecated.
   *
   * @global
   */
  function log(...data: unknown[]): void;
  /**
   * @deprecated use {@link console} instead.
   */
  interface SandboxConsole {
    /**
     * @deprecated use {@link log} instead.
     */
    log(...data: unknown[]): void;
  }
  /**
   * `history` is an array of recent actions from the adventure, see {@link History}.
   *
   * @global
   */
  let history: History[];
  /**
   * `storyCards` is an array of [story cards](https://help.aidungeon.com/faq/story-cards) from the adventure, see {@link StoryCard}.
   *
   * @global
   */
  let storyCards: Partial<StoryCard>[];
  // Omit<StoryCard, 'createdAt' | 'updatedAt' | 'useForCharacterCreation'>
  /**
   * @deprecated use {@link storyCards} instead.
   */
  let worldInfo: StoryCard[];
  /**
   * This field is an object where scripts can store additional persistent information to be available across turns. Beyond being an object, this field can have any structure needed for the script.
   *
   * To change the state, scripts can set values in the state object directly, without using a helper function.
   *
   * In addition to creator-defined fields, the state object also expects to have the following fields.
   *
   * @global
   */
  let state: State & { [key: string]: unknown };
  /**
   * This is **user**-defined memory, {@link state.memory} has priority
   *
   * @global
   */
  let memory: {
    context?: plotEssentials;
    [key: string]: unknown;
  };

  /**
   * ---
   *
   * _Example(s):_
   *
   * ```js
   * // For `onOutput` hook
   * if (typeof text === "string") text = text.replace(/\s{2,}|\n/g, '\n\n');
   * return { text };
   * ```
   *
   * ---
   *
   * - For the `onInput` hook, this field has the text entered by the player.
   *   - _Returns:_ an empty string in `onInput` throws an {@link Error} which is shown to the player and says **`Unable to run scenario scripts.`**
   * - For the `onModelContext` hook, this field has the text that would otherwise be sent to the AI.
   *   - _Returns:_ an empty string in `onModelContext` causes the context to be built as though the script did not run.
   * - For the `onOutput` hook, this field has the text that would otherwise be sent back to the player.
   *   - _Returns:_ an empty string in `onOutput` throws an {@link Error} which is shown to the player and says **`A custom script running on this scenario failed. Please try again or fix the script.`**
   *
   * Returning the text {@link stop} is equivalent to returning `stop: true`.
   *
   * @global
   */
  let text: typeof stop extends undefined | false ? null : string;
  // let text: string | null;
  type Text = typeof text;

  /**
   * ---
   *
   * _Example(s):_
   *
   * ```js
   * // For `onInput` hook
   * let stop = typeof text === "string" && text.includes("Pause the story");
   * if (stop) text = null;
   * return { text, stop };
   * ```
   *
   * ---
   *
   * If `stop === true`, then the game loop will not proceed. This is useful in cases where you want a player input to update the state but to not run the AI.
   *
   * When you return `stop` in the `onInput` hook, it throws an {@link Error} which is shown to the player and says **`Unable to run scenario scripts`**
   *
   * When you return `stop` in the `onModelContext` hook, it throws an {@link Error} which is shown to the player and says **`Sorry, the AI is stumped. Edit/retry your previous action, or write something to help it along.`**
   *
   * When you return `stop` in the `onOutput` hook, it changes the output to `stop`. Don’t do this.
   *
   * @global
   */
  let stop: boolean | undefined;
  type Stop = typeof stop;

  /**
   * This field is an object that can contain additional values that may sometimes be useful. These values may be different for different hooks.
   * - All Hooks
   *   - `characterNames` - an array of character names for players of a multiplayer adventure
   *   - {@link info.actionCount} - the total number of actions in the adventure
   * - onModelContext
   *   - {@link info.maxChars} - the estimated maximum number of characters that can be included in the model context (character per token can vary)
   *   - {@link info.memoryLength} - the number of characters included in the model context from the memory
   *
   * @global
   */
  const info: Info & { [key: string]: unknown };
}
// #endregion