import fs from 'fs';
import path from 'path';
import { openAIClient } from '../../services/openai/openai';
import { centralaClient } from '../../clients/centrala/client';

async function robotId(): Promise<void> {
    const descriptionResponse = await centralaClient.getRobotIdFile();
    const description = descriptionResponse.data.description;
    console.log(description);
    const prompt = `A robot in a realistic style. The robot should be based on the following description: ${description}. The background should be a simple, light-colored background The image should contain all the details from the description.`;

    const imageUrl = await openAIClient.generateImage(prompt);
    console.log('Image URL:', imageUrl);

    let flag = await centralaClient.report('robotid', imageUrl);
    console.log(flag.data);
}

robotId().catch(console.error);
