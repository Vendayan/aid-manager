import * as vscode from "vscode";
import * as ts from "typescript";

const SHARED_TYPES_FILE = "SharedLibraryTypes.d.ts";
const SCRIPT_FILE = "aid-script.js";
const SCRIPTING_TYPES_FILE = "ScriptingTypes.d.ts";

const compilerOptions: ts.CompilerOptions = {
  allowJs: true,
  target: ts.ScriptTarget.ES2022,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  module: ts.ModuleKind.ESNext,
  noLib: true
};

const kindMap = new Map<string, vscode.CompletionItemKind>([
  [ts.ScriptElementKind.keyword, vscode.CompletionItemKind.Keyword],
  [ts.ScriptElementKind.primitiveType, vscode.CompletionItemKind.Keyword],
  [ts.ScriptElementKind.constElement, vscode.CompletionItemKind.Constant],
  [ts.ScriptElementKind.letElement, vscode.CompletionItemKind.Variable],
  [ts.ScriptElementKind.variableElement, vscode.CompletionItemKind.Variable],
  [ts.ScriptElementKind.localVariableElement, vscode.CompletionItemKind.Variable],
  [ts.ScriptElementKind.variableUsingElement, vscode.CompletionItemKind.Variable],
  [ts.ScriptElementKind.variableAwaitUsingElement, vscode.CompletionItemKind.Variable],
  [ts.ScriptElementKind.functionElement, vscode.CompletionItemKind.Function],
  [ts.ScriptElementKind.localFunctionElement, vscode.CompletionItemKind.Function],
  [ts.ScriptElementKind.memberFunctionElement, vscode.CompletionItemKind.Method],
  [ts.ScriptElementKind.memberGetAccessorElement, vscode.CompletionItemKind.Property],
  [ts.ScriptElementKind.memberSetAccessorElement, vscode.CompletionItemKind.Property],
  [ts.ScriptElementKind.memberVariableElement, vscode.CompletionItemKind.Field],
  [ts.ScriptElementKind.memberAccessorVariableElement, vscode.CompletionItemKind.Field],
  [ts.ScriptElementKind.constructorImplementationElement, vscode.CompletionItemKind.Constructor],
  [ts.ScriptElementKind.interfaceElement, vscode.CompletionItemKind.Interface],
  [ts.ScriptElementKind.classElement, vscode.CompletionItemKind.Class],
  [ts.ScriptElementKind.localClassElement, vscode.CompletionItemKind.Class],
  [ts.ScriptElementKind.typeElement, vscode.CompletionItemKind.Struct],
  [ts.ScriptElementKind.parameterElement, vscode.CompletionItemKind.Variable],
  [ts.ScriptElementKind.enumElement, vscode.CompletionItemKind.Enum],
  [ts.ScriptElementKind.enumMemberElement, vscode.CompletionItemKind.EnumMember],
  [ts.ScriptElementKind.alias, vscode.CompletionItemKind.Reference],
  [ts.ScriptElementKind.moduleElement, vscode.CompletionItemKind.Module],
  [ts.ScriptElementKind.callSignatureElement, vscode.CompletionItemKind.Function],
  [ts.ScriptElementKind.constructSignatureElement, vscode.CompletionItemKind.Method],
  [ts.ScriptElementKind.indexSignatureElement, vscode.CompletionItemKind.Method],
  [ts.ScriptElementKind.jsxAttribute, vscode.CompletionItemKind.Property]
]);

export class SharedLibraryIntellisense implements vscode.CompletionItemProvider, vscode.HoverProvider {
  private readonly sharedSnapshot: ts.IScriptSnapshot;
  private readonly scriptingSnapshot?: ts.IScriptSnapshot;
  private readonly includeScriptingTypes: boolean;

  public constructor(sharedLibrarySource: string, scriptingSource?: string, includeScriptingTypes = true) {
    this.sharedSnapshot = ts.ScriptSnapshot.fromString(sharedLibrarySource);
    this.includeScriptingTypes = includeScriptingTypes && !!scriptingSource;
    if (scriptingSource && includeScriptingTypes) {
      this.scriptingSnapshot = ts.ScriptSnapshot.fromString(scriptingSource);
    }
  }

  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token?: vscode.CancellationToken,
    _context?: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    const service = this.createLanguageService(document);
    try {
      const offset = document.offsetAt(position);
      const completions = service.getCompletionsAtPosition(SCRIPT_FILE, offset, {});
      if (!completions) {
        return undefined;
      }
      return completions.entries.map((entry) => this.convertCompletion(entry, service, offset));
    } finally {
      service.dispose();
    }
  }

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const service = this.createLanguageService(document);
    try {
      const info = service.getQuickInfoAtPosition(SCRIPT_FILE, document.offsetAt(position));
      if (!info) {
        return undefined;
      }
      const signature = ts.displayPartsToString(info.displayParts);
      const docs = ts.displayPartsToString(info.documentation);
      const md = new vscode.MarkdownString(undefined, true);
      if (signature) {
        md.appendCodeblock(signature, "typescript");
      }
      if (docs) {
        md.appendMarkdown("\n\n" + docs);
      }
      return new vscode.Hover(md);
    } finally {
      service.dispose();
    }
  }

  private convertCompletion(entry: ts.CompletionEntry, service: ts.LanguageService, position: number): vscode.CompletionItem {
    const item = new vscode.CompletionItem(entry.name, this.toCompletionItemKind(entry.kind));
    item.sortText = entry.sortText;
    item.commitCharacters = entry.commitCharacters;
    item.insertText = entry.insertText ?? entry.name;

    const details = service.getCompletionEntryDetails(
      SCRIPT_FILE,
      position,
      entry.name,
      undefined,
      entry.source,
      undefined,
      entry.data
    );

    if (details) {
      item.detail = ts.displayPartsToString(details.displayParts);
      const docs = ts.displayPartsToString(details.documentation);
      if (docs) {
        item.documentation = new vscode.MarkdownString(docs, true);
      }
    }

    return item;
  }

  private toCompletionItemKind(kind?: string): vscode.CompletionItemKind {
    if (kind && kindMap.has(kind)) {
      return kindMap.get(kind)!;
    }
    return vscode.CompletionItemKind.Text;
  }

  private createLanguageService(document: vscode.TextDocument): ts.LanguageService {
    const scriptSnapshot = ts.ScriptSnapshot.fromString(document.getText());
    const scriptVersion = String(document.version);
    const sharedVersion = "1";

    const fileNames = [SCRIPT_FILE, SHARED_TYPES_FILE];
    if (this.includeScriptingTypes) {
      fileNames.push(SCRIPTING_TYPES_FILE);
    }
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => compilerOptions,
      getScriptFileNames: () => fileNames,
      getScriptVersion: (fileName) => (fileName === SCRIPT_FILE ? scriptVersion : sharedVersion),
      getScriptSnapshot: (fileName) => {
        if (fileName === SCRIPT_FILE) {
          return scriptSnapshot;
        }
        if (fileName === SHARED_TYPES_FILE) {
          return this.sharedSnapshot;
        }
        if (fileName === SCRIPTING_TYPES_FILE && this.includeScriptingTypes && this.scriptingSnapshot) {
          return this.scriptingSnapshot;
        }
        return undefined;
      },
      getCurrentDirectory: () => "",
      getDefaultLibFileName: () => "lib.d.ts",
      useCaseSensitiveFileNames: () => true,
      fileExists: (fileName) => {
        if (fileName === SCRIPT_FILE || fileName === SHARED_TYPES_FILE) {
          return true;
        }
        if (fileName === SCRIPTING_TYPES_FILE && this.includeScriptingTypes) {
          return true;
        }
        return false;
      },
      readFile: () => undefined,
      readDirectory: () => [],
      directoryExists: () => true,
      getScriptKind: (fileName) => (fileName.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS)
    };

    return ts.createLanguageService(host, ts.createDocumentRegistry());
  }
}
