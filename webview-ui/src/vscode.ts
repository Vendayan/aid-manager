declare const acquireVsCodeApi:
  | undefined
  | (() => {
      postMessage: (message: unknown) => void;
      setState?: (state: unknown) => void;
      getState?: () => unknown;
    });

type VsCodeApi = ReturnType<NonNullable<typeof acquireVsCodeApi>>;

const vscode: VsCodeApi = (typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : {
  postMessage: () => {
    // noop fallback for local dev
  }
}) as VsCodeApi;

export default vscode;
