import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// A new dependency and a deploy are a pair, exactly as a .sql migration and a
// deploy are.
//
// The production deploy is `git pull && npm run build`. It does NOT install
// anything. On 2026-09-21 the exceljs dependency shipped with that two-step
// instruction and the build died on the server with "Cannot find module
// 'exceljs'", because the report never said an install was needed.
//
// Prose in CLAUDE.md is not a mechanism: the next person adds a package and
// the rule is a paragraph they did not read. This test fails the moment the
// dependency list changes, and its message is the deploy step itself, so the
// omission cannot reach the server.
//
// To update: add the package below AND put `npm install` in the deploy
// instructions you hand over. Both, in the same change.
const PINNED = {
  dependencies: {
    "@supabase/supabase-js": "^2.108.2",
    exceljs: "^4.4.0",
    jszip: "^3.10.1",
    mammoth: "^1.12.0",
    "pdfjs-dist": "^6.0.227",
    react: "^19.2.7",
    "react-dom": "^19.2.7",
    "react-router-dom": "^7.18.0",
    xlsx: "^0.18.5",
    zustand: "^5.0.14",
  },
  devDependencies: {
    "@tailwindcss/postcss": "^4.3.1",
    "@types/node": "^24.13.2",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.2",
    autoprefixer: "^10.5.2",
    oxlint: "^1.69.0",
    postcss: "^8.5.15",
    tailwindcss: "^4.3.1",
    typescript: "~6.0.2",
    vite: "^8.1.0",
    vitest: "^3.2.6",
  },
} as const;

const REMINDER =
  "\n\n  The dependency list changed. `git pull && npm run build` does NOT install " +
  "anything, so the server will fail with \"Cannot find module\".\n" +
  "  Update the PINNED list in this file AND hand over the deploy as:\n" +
  "      cd /var/www/gd4_simulator && git pull && npm install && npm run build\n";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("a dependency change is half of a deploy", () => {
  it("has not added or removed a runtime dependency without saying so", () => {
    expect(Object.keys(pkg.dependencies).sort(), REMINDER).toEqual(Object.keys(PINNED.dependencies).sort());
  });

  it("has not added or removed a dev dependency without saying so", () => {
    expect(Object.keys(pkg.devDependencies).sort(), REMINDER).toEqual(Object.keys(PINNED.devDependencies).sort());
  });

  it("has not bumped a version without saying so", () => {
    // A bump needs an install on the server just as much as an addition does.
    expect({ ...pkg.dependencies, ...pkg.devDependencies }, REMINDER)
      .toEqual({ ...PINNED.dependencies, ...PINNED.devDependencies });
  });

  it("keeps the lockfile committed, so the server installs what was tested", () => {
    expect(() => readFileSync("package-lock.json", "utf8")).not.toThrow();
  });

  it("does not list playwright-core, which is a sandbox-only verification tool", () => {
    // It is installed with --no-save for the live-verification cookbook. In
    // package.json it would become something the production server installs
    // for no reason, and it pulls a browser download.
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all)).not.toContain("playwright-core");
  });
});
