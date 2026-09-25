/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // three.js ships ESM examples; let Next transpile them for the browser bundle
  transpilePackages: ['three'],
}

export default nextConfig
