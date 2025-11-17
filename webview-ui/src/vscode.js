const vscode = (typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : {
    postMessage: () => {
        // noop fallback for local dev
    }
});
export default vscode;
//# sourceMappingURL=vscode.js.map