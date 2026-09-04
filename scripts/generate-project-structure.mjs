/*
 * PROJECT STRUCTURE GENERATOR
 *
 * WHAT IS THIS?
 * -------------
 * Generates PROJECT_STRUCTURE.txt containing:
 *
 *   - The complete folder/file structure
 *   - A GitHub URL for every file
 *   - The current Git branch and commit
 *
 * HOW TO USE
 * ----------
 * Run this from the project root:
 *
 *   node scripts/generate-project-structure.mjs
 *
 * This creates:
 *
 *   PROJECT_STRUCTURE.txt
 *
 * The generated .txt file is intended to stay LOCAL.
 * It should NOT be committed to Git.
 *
 * AUTOMATIC DETECTION
 * -------------------
 * The script automatically detects:
 *
 *   - Your GitHub repository from the "origin" remote
 *   - Your current Git branch
 *   - The exact current commit SHA for immutable file URLs
 *
 * IGNORED
 * -------
 * These are excluded from the generated structure:
 *
 *   .git
 *   node_modules
 *   dist
 *   build
 *   .vite
 *   .cache
 *   .DS_Store
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const OUTPUT_FILE = "PROJECT_STRUCTURE.txt";

const IGNORE = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".vite",
  ".cache",
  ".DS_Store",
]);

function runGit(command) {
  try {
    return execSync(command, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function getGitHubRepository() {
  const remote = runGit("git remote get-url origin");

  if (!remote) {
    throw new Error(
      "No Git remote named 'origin' was found."
    );
  }

  const match = remote.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/
  ) || remote.match(
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/
  );

  if (!match) {
    throw new Error(
      "The 'origin' remote is not a GitHub repository."
    );
  }

  const owner = match[1];
  const repo = match[2];

  return "https://github.com/" + owner + "/" + repo;
}

function getCurrentBranch() {
  const branch = runGit("git branch --show-current");

  if (!branch) {
    throw new Error(
      "Could not determine the current Git branch."
    );
  }

  return branch;
}

function getCurrentCommit() {
  const commit = runGit("git rev-parse HEAD");

  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error(
      "Could not determine a full 40-character Git commit SHA. Commit the current work before generating the structure."
    );
  }

  return commit;
}

function getEntries(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !IGNORE.has(entry.name))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) {
        return -1;
      }

      if (!a.isDirectory() && b.isDirectory()) {
        return 1;
      }

      return a.name.localeCompare(b.name);
    });
}

function getGitHubFileUrl(relativePath, githubUrl, commit) {
  const encodedPath = relativePath
    .split(path.sep)
    .map(encodeURIComponent)
    .join("/");

  return (
    githubUrl +
    "/blob/" +
    commit +
    "/" +
    encodedPath
  );
}

function renderDirectory(
  directory,
  relativeDirectory,
  prefix,
  githubUrl,
  commit
) {
  const entries = getEntries(directory);
  const lines = [];

  entries.forEach((entry, index) => {
    const isLast = index === entries.length - 1;

    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    const absolutePath = path.join(
      directory,
      entry.name
    );

    const relativePath = relativeDirectory
      ? path.join(relativeDirectory, entry.name)
      : entry.name;

    if (entry.isDirectory()) {
      lines.push(
        prefix + connector + entry.name + "/"
      );

      const children = renderDirectory(
        absolutePath,
        relativePath,
        prefix + childPrefix,
        githubUrl,
        commit
      );

      lines.push(...children);
    } else {
      lines.push(
        prefix + connector + entry.name
      );

      lines.push(
        prefix +
          childPrefix +
          getGitHubFileUrl(
            relativePath,
            githubUrl,
            commit
          )
      );
    }
  });

  return lines;
}

function main() {
  const githubUrl = getGitHubRepository();
  const branch = getCurrentBranch();
  const commit = getCurrentCommit();
  const projectName = path.basename(ROOT);

  const tree = renderDirectory(
    ROOT,
    "",
    "",
    githubUrl,
    commit
  );

  const output = [
    projectName + "/",
    "",
    ...tree,
    "",
  ].join("\n");

  const outputPath = path.join(
    ROOT,
    OUTPUT_FILE
  );

  fs.writeFileSync(
    outputPath,
    output,
    "utf8"
  );

  console.log("");
  console.log(
    "Project structure generated successfully!"
  );
  console.log("");
  console.log("Repository: " + githubUrl);
  console.log("Branch:     " + branch);
  console.log("Commit:     " + commit);
  console.log("Output:     " + OUTPUT_FILE);
  console.log("");
}

try {
  main();
} catch (error) {
  console.error("");
  console.error("ERROR:");
  console.error(error.message);
  console.error("");
  process.exit(1);
}