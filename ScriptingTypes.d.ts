
import './SharedLibraryTypes.d.ts';

/**
 * Scripting API: https://help.aidungeon.com/scripting
 * 
 * Scripting Guidebook: https://github.com/magicoflolis/aidungeon.js/blob/main/Scripting%20Guidebook.md
 */
export type ScriptingAPI = unknown;

// #region Global
declare global {
  /**
   * Ensures `modifier` function exists & prevent it from being `undefined`
   *
   * _This is the last executed function in the chain._
   */
  function modifier<T extends typeof text>(
    text: T
  ): {
    text: T;
    stop?: typeof stop;
  };

  /**
   * Ensures `modifier` function exists & prevent it from being `undefined`
   *
   * _This is the last executed function in the chain._
   */
  type Modifier = <T extends typeof text>(text: T) => { text: T; stop?: typeof stop };
}
// #endregion
