import { xyzClient } from '../../clients/xyz/client';
import type { VerificationMessage } from '../../clients/xyz/types';
import { openAIClient } from '../../services/openai/openai';

async function verifyIdentity(): Promise<void> {
    let msgID = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 5;
    
    // Start verification by sending READY command
    let startResponse: VerificationMessage = await xyzClient.sendVerificationMessage('READY', 0);
    
    msgID = startResponse.msgID;
    console.log(`Received question with msgID: ${msgID}`);
    
    // Process robot's questions
    while (attempts < MAX_ATTEMPTS) {
        const question = startResponse.text;
        console.log(`Robot's question: ${question}`);
        
        // Use OpenAI to generate the response
        const responseText = await openAIClient.answerQuestion(question);
        console.log(`AI response: ${responseText}`);
        
        console.log(`Sending response: ${responseText}`);
        
        // Send response back to robot
        const robotResponse: VerificationMessage = await xyzClient.sendVerificationMessage(responseText, msgID);
        startResponse = robotResponse;

        if (!robotResponse.text) {
            console.log('No response received from robot');
            console.log(robotResponse);
            break
        }

        if (robotResponse.text.includes('FLG')) {
            console.log('Verification successful!');
            console.log(robotResponse);
            break;
        }

        console.log(`Received robot response: ${robotResponse.text}`);

        // Check if verification is complete
        if (robotResponse.text === 'OK') {
            console.log('Verification successful!');
            break;
        }
        
        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
            console.log('Maximum number of attempts reached. Verification failed.');
            break;
        }
        
        // Update msgID for next iteration
        msgID = robotResponse.msgID;
        startResponse = robotResponse;

        // Wait a bit before next question
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

// Run the verification process
verifyIdentity().catch(console.error);
