import * as assert from "assert";
import { AIDClient } from "../AIDClient";

suite("AIDClient", () => {
  test("maps current state.scripts response to legacy gameCode fields", async () => {
    const client = new AIDClient({} as any, {} as any) as any;
    client.gql = async () => ({
      scenario: {
        state: {
          scripts: {
            sharedLibrary: "shared",
            onInput: "input",
            onOutput: "output",
            onModelContext: "context"
          }
        }
      }
    });

    const scripts = await client.getScenarioScripting("demo");

    assert.deepStrictEqual(scripts, {
      gameCodeSharedLibrary: "shared",
      gameCodeOnInput: "input",
      gameCodeOnOutput: "output",
      gameCodeOnModelContext: "context"
    });
  });

  test("maps updateScenarioScripts response to legacy gameCode fields", async () => {
    const client = new AIDClient({} as any, {} as any) as any;
    client.gql = async () => ({
      updateScenarioScripts: {
        success: true,
        message: null,
        scenario: {
          state: {
            scripts: {
              sharedLibrary: "shared",
              onInput: "input",
              onOutput: null,
              onModelContext: "context"
            }
          }
        }
      }
    });

    const result = await client.updateScenarioScripts("demo", {
      sharedLibrary: "shared",
      onInput: "input",
      onOutput: null,
      onModelContext: "context"
    });

    assert.deepStrictEqual(result.scenario, {
      gameCodeSharedLibrary: "shared",
      gameCodeOnInput: "input",
      gameCodeOnOutput: null,
      gameCodeOnModelContext: "context"
    });
  });
});
