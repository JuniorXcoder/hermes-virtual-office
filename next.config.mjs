/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // three.js ships ESM examples; let Next transpile them for the browser bundle
  transpilePackages: ['three'],
  // Dev (`hermes verify` starts it too) must not share .next with the production
  // build: mixed dev+prod artifacts made `next start` serve 500/404. The dev
  // script pins NODE_ENV=development, so only dev gets its own directory.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
}

export default nextConfig
