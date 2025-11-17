import * as assert from "assert";
import * as vscode from "vscode";
import { AidFsProvider } from "../AIDFSProvider";

class FakeClient {
  public calls = 0;
  private responses: Array<{
    gameCodeSharedLibrary?: string | null;
    gameCodeOnInput?: string | null;
    gameCodeOnOutput?: string | null;
    gameCodeOnModelContext?: string | null;
  }>;

  constructor(responses: FakeClient["responses"]) {
    this.responses = responses;
  }

  async getScenarioScripting(_shortId: string) {
    this.calls += 1;
    if (!this.responses.length) {
      return {};
    }
    return this.responses.shift() ?? {};
  }
}

suite("AidFsProvider", () => {
  test("clearSnapshot forces subsequent reads to refetch scripts", async () => {
    const client = new FakeClient([
      { gameCodeSharedLibrary: "first", gameCodeOnInput: "", gameCodeOnOutput: "", gameCodeOnModelContext: "" },
      { gameCodeSharedLibrary: "second", gameCodeOnInput: "", gameCodeOnOutput: "", gameCodeOnModelContext: "" }
    ]);

    const provider = new AidFsProvider(
      client as any,
      async () => { /* noop */ },
      async () => Buffer.from("{}", "utf8")
    );

    const uri = vscode.Uri.from({ scheme: "aid", path: "/scenario/demo/sharedLibrary.js" });

    const buf1 = await provider.readFile(uri);
    assert.strictEqual(Buffer.from(buf1).toString("utf8"), "first");
    assert.strictEqual(client.calls, 1, "first read should hit GraphQL");

    const buf2 = await provider.readFile(uri);
    assert.strictEqual(Buffer.from(buf2).toString("utf8"), "first");
    assert.strictEqual(client.calls, 1, "second read should use cached snapshot");

    provider.clearSnapshot("demo");
    const buf3 = await provider.readFile(uri);
    assert.strictEqual(Buffer.from(buf3).toString("utf8"), "second");
    assert.strictEqual(client.calls, 2, "cache eviction should trigger another fetch");
  });

  test("clearSnapshot emits change events when a snapshot existed", async () => {
    const client = new FakeClient([
      { gameCodeSharedLibrary: "first", gameCodeOnInput: "", gameCodeOnOutput: "", gameCodeOnModelContext: "" }
    ]);

    const provider = new AidFsProvider(
      client as any,
      async () => { /* noop */ },
      async () => Buffer.from("{}", "utf8")
    );

    provider.applyServerSnapshot("demo", {
      sharedLibrary: "cache",
      onInput: null,
      onOutput: null,
      onModelContext: null
    });

    let changeEvents = 0;
    provider.onDidChangeFile(() => {
      changeEvents += 1;
    });

    provider.clearSnapshot("demo");
    assert.strictEqual(changeEvents > 0, true, "clearing an existing snapshot should emit change events");
  });
});
