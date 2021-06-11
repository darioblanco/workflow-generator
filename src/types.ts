interface Workflow {
  file: string;
  overlays?: string[];
}
export interface Config {
  global: {
    values?: Record<string, string>;
    workflows: Workflow[];
  };
  scoped: {
    name: string;
    values?: Record<string, string>;
    workflows: Workflow[];
  }[];
}
