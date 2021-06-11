export interface Config {
  global: {
    overlays?: string[];
    values?: Record<string, string>;
    workflows: string[];
  };
  scoped: {
    name: string;
    overlays?: string[];
    values?: Record<string, string>;
    workflows: string[];
  }[];
}
