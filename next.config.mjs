/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/site-analytics/plugin": ["./wordpress/gripp-site-analytics/**/*"]
  }
};

export default nextConfig;
