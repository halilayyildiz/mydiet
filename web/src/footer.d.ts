export interface BuildInfo {
  version: string;
  date?: string;
}
export function mountFooter(info: BuildInfo | string | null, options?: { home?: boolean; parent?: HTMLElement | null }): HTMLElement;
