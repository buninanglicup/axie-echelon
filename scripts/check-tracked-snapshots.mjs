import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files", "--", "data/snapshots"], { encoding: "utf8" }).trim();
if (tracked) {
  console.error("Raw snapshot files must remain local and gitignored:");
  console.error(tracked);
  process.exit(1);
}

console.log("No snapshot files are tracked.");
