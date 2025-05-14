console.log("Hello via Bun!");

import 'dotenv/config';

const openAiKey = process.env.OPENAI_API_KEY;

console.log(openAiKey);
