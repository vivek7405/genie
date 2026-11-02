// The auth catch-all: GitHub calls back to /api/auth/callback/github.
import { handlers } from '#modules/auth/auth.server.ts';

export const { GET, POST } = handlers;
