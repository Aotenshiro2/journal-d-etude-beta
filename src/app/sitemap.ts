import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://journal.aoknowledge.com/auth',
      changeFrequency: 'yearly',
      priority: 1.0,
    },
  ]
}
