import { evaluate } from 'mathjs';
import { openAIClient } from '../../services/openai/openai';
import { centralaClient } from '../../clients/centrala/client';


async function runCalibration(): Promise<void> {

    // get CENTRALA_SECRET
    const centralaSecret = process.env.CENTRALA_SECRET;
    if (!centralaSecret) {
        throw new Error('CENTRALA_SECRET is not defined');
    }

    const calibrationData = require('./calibration.json');

    calibrationData['apikey'] = centralaSecret;

    // Using Promise.all with map to properly handle async operations
    await Promise.all(calibrationData['test-data'].map(async (test: any) => {
        const result = evaluate(test.question);
        if (result !== test.answer) {
            test.answer = result;
        }

        if (test.test) {
            const answer = await openAIClient.answerQuestion(test.test.q);
            test.test.a = answer;
        }
        
        // The test object is modified in-place, which updates calibrationData
        return test;
    }));

    const response = await centralaClient.report('JSON', calibrationData);

    console.log(response)

    
}


runCalibration().catch(console.error);
