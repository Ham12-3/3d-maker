import defaultWorldJson from "./worlds/default.json";
import { WorldSchema, type World } from "./schema";

/** The starting world. Edit `worlds/default.json` and reload to change it. */
export function loadDefaultWorld(): World {
  const parsed = WorldSchema.safeParse(defaultWorldJson);
  if (!parsed.success) {
    throw new Error(`worlds/default.json is invalid:\n${formatIssues(parsed.error.issues)}`);
  }
  return parsed.data;
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `  ${i.path.map(String).join(".")}: ${i.message}`).join("\n");
}
