export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    // Proxy all /api/ calls to the 7/24 Oracle Cloud VPS backend
    if (url.pathname.startsWith('/api/')) {
      const vpsUrl = `http://130.61.53.100${url.pathname}${url.search}`;
      const headers = new Headers(request.headers);
      headers.set('Host', '130.61.53.100');

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
