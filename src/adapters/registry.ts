import { githubAdapter } from "./github";
import type { SiteAdapter } from "./types";

export class AdapterRegistry {
  constructor(private readonly adapters: readonly SiteAdapter[]) {}

  select(url: URL): SiteAdapter | null {
    return this.adapters.find((adapter) => adapter.matches(url)) ?? null;
  }
}

export const defaultRegistry = new AdapterRegistry([githubAdapter]);
