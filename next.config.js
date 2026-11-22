/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev-webpack' : '.next',
  devIndicators: false,
  allowedDevOrigins: ['127.0.0.1'],
  transpilePackages: ['@deriv/core'],
}

module.exports = nextConfig
