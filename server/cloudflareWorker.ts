const BACKEND_HOST = 'https://writing-cameron-worlds-police.trycloudflare.com';

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    // Proxy all /api/ calls to the 7/24 Oracle Cloud VPS backend
    if (url.pathname.startsWith('/api/')) {
      const vpsUrl = `${BACKEND_HOST}${url.pathname}${url.search}`;
      const headers = new Headers(request.headers);
      headers.set('Host', new URL(BACKEND_HOST).host);

      const isBodyAllowed = request.method !== 'GET' && request.method !== 'HEAD';
      return fetch(vpsUrl, {
        method: request.method,
        headers,
        body: isBodyAllowed ? request.body : undefined
      });
    }

    // Serve static client assets (dist/)
    return env.ASSETS.fetch(request);
  }
};
