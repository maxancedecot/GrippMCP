/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{
      source: "/alice-buyssehof/embed",
      headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }]
    }];
  },
  outputFileTracingIncludes: {
    "/api/site-analytics/plugin": ["./wordpress/gripp-site-analytics/**/*"]
  }
};

export default nextConfig;
