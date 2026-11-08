// Writes io/ios.txt and io/ios.jsonl from io/cases.mjs (npm run ios).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeIos, toJsonl, toText } from './engine.mjs';
import { cases, title } from './cases.mjs';

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const ios = await makeIos(cases);
fs.writeFileSync(here('./ios.txt'), toText(ios, title));
fs.writeFileSync(here('./ios.jsonl'), toJsonl(ios));
const errors = ios.filter((io) => io.output && io.output.error).length;
console.log(`${ios.length} inputs and outputs written to io/ios.txt and io/ios.jsonl (${cases.length} functions, ${errors} raised errors on purpose or otherwise)`);
