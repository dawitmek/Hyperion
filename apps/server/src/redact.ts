import type { FastifyRequest } from 'fastify';

// Overlay links are secrets (/overlay/<token> and /ws/overlay?token=…), so they never reach the request log:
// anyone who can read the log could otherwise watch or take over a host's overlay.
export function redactUrl(url: string) {
  return url.replace(/^(\/overlay\/)[^/?#]+/, '$1[redacted]').replace(/([?&]token=)[^&#]*/g, '$1[redacted]');
}

// Fastify's own request serializer, with the URL redacted.
export function requestSerializer(req: FastifyRequest) {
  return { method: req.method, url: redactUrl(req.url), host: req.host, remoteAddress: req.ip, remotePort: req.socket?.remotePort };
}
