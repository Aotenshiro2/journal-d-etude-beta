import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/auth',
        disallow: ['/', '/study', '/concepts', '/journal', '/market', '/review', '/analytics', '/guide', '/api'],
      },
    ],
    sitemap: 'https://journal.aoknowledge.com/sitemap.xml',
  }
}
