export interface Config {
  global: {
    values?: Record<string, string>;
    workflows: string[];
  };
  scoped: {
    name: string;
    values?: Record<string, string>;
    workflows: string[];
  }[];
}
