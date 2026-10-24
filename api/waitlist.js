import { HttpError, jsonError, safeLog } from '../lib/http.js';
import { handleWaitlist } from '../lib/waitlist.js';

export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, 'Send a JSON email');
    }
    const result = await handleWaitlist(body?.email, {
      webhookUrl: process.env.WAITLIST_WEBHOOK_URL || '',
    });
    return Response.json(result);
  } catch (err) {
    safeLog(err);
    return jsonError(err);
  }
}
