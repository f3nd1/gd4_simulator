/// <reference types="vite/client" />

declare const __GIT_INFO__: {
  hash: string;
  branch: string;
  message: string;
  isoTime: string;
  ahead: number;
};

// Full commit history embedded at build time (see gitLog() in vite.config.ts).
declare const __GIT_LOG__: {
  hash: string;
  shortHash: string;
  author: string;
  isoTime: string;
  subject: string;
  body: string;
  files: string[];
}[];
