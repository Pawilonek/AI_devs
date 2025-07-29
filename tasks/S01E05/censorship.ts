import fs from 'fs';

import { centralaClient } from '../../clients/centrala/client';
import { openAIClient } from '../../services/openai/openai';

async function censorship(): Promise<void> {
    let cenzuraFile = await centralaClient.getCenzuraFile();
    let dataToCensor = cenzuraFile.data;
    console.log(`dataToCensor: ${dataToCensor}`);

    const dirname = new URL('.', import.meta.url).pathname;
    fs.writeFileSync(`${dirname}/cenzura.txt`, dataToCensor);
    
    let censored = await openAIClient.censor(dataToCensor);
    console.log(`censored: ${censored}`);
    
    let flag = await centralaClient.report('CENZURA', censored);
    console.log(flag.data);
}

censorship().catch(console.error);
