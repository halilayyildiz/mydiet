export interface BuildInfo {
  version: string;
  date?: string;
  commit?: string;
  repo?: string;
  changes?: { date: string; subject: string }[];
}
export function mountFooter(info: BuildInfo | string | null, options?: { home?: boolean; parent?: HTMLElement | null }): HTMLElement;
