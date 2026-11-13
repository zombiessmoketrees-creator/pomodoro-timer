declare module "*.css";

// Webpack-only API used to auto-discover style presets in /styles.
interface WebpackRequireContext {
  keys(): string[];
  <T = unknown>(id: string): T;
}
interface NodeRequire {
  context(directory: string, useSubdirectories: boolean, regExp: RegExp): WebpackRequireContext;
}
declare const require: NodeRequire;
