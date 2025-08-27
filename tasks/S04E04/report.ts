import 'dotenv/config';
import { centralaClient } from '../../clients/centrala/client';

/**
 * Reports public webhook URL to Centrala.
 * Env required:
 * - CENTRALA_URL
 * - CENTRALA_SECRET (apikey)
 * - PUBLIC_WEBHOOK_URL
 */
async function main() {
  const publicUrl = process.env.PUBLIC_WEBHOOK_URL || '';
  if (!publicUrl) {
    console.error('PUBLIC_WEBHOOK_URL is required');
    process.exit(1);
  }

  try {
    const resp = await centralaClient.report('webhook', publicUrl);
    const data = resp?.data ?? resp;
    console.log('Report response:', typeof data === 'string' ? data : JSON.stringify(data));
  } catch (e) {
    console.error('Failed to report webhook URL:', e);
    process.exit(1);
  }
}

main();
