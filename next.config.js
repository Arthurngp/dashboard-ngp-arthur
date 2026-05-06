/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true,

  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    minimumCacheTTL: 60 * 60 * 24 * 7, // 7 days
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },

  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'chart.js',
      'react-chartjs-2',
    ],
  },

  webpack(config) {
    config.optimization = {
      ...config.optimization,
      moduleIds: 'deterministic',
    }
    return config
  },
}

module.exports = nextConfig
