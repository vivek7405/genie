/**
 * The GitHub App's webhook. GitHub POSTs one delivery per event; the
 * signature over the RAW body is checked before anything is parsed, and
 * the sync it asks for runs after the response, never inside it.
 *
 * 503 without a secret (the App cannot be trusted yet), 401 on a bad
 * signature (nothing of the body is logged), 200 for ping, 204 for an event
 * the sync does not read, 202 with the number of projects scheduled.
 */
import { classify, handleDelivery, verifySignature } from '#modules/github/webhook.server.ts';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) return new Response('GITHUB_APP_WEBHOOK_SECRET is not set', { status: 503 });
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'), secret)) return new Response('Bad signature', { status: 401 });
  const event = req.headers.get('x-github-event') ?? '';
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('Bad payload', { status: 400 });
  }
  if (!classify(event, payload)) return new Response(null, { status: 204 });
  if (event === 'ping') return Response.json({ ok: true });
  const scheduled = await handleDelivery(event, payload);
  return Response.json({ scheduled }, { status: 202 });
}

export async function GET(): Promise<Response> {
  return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
}
