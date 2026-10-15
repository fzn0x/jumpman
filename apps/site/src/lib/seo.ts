import { featureGroups } from '../data/features'
import { screens } from '../data/screens'
import { links, SITE_NAME, withBase } from './site'

export const HOME_DESCRIPTION =
  'Free, open-source batch photo editor. Edit multiple photos at once with presets, LUTs, layers and Lightroom XMP, offline in your browser or on Android.'

/** schema.org SoftwareApplication for the landing page. */
export function softwareApplicationJsonLd(site: URL): Record<string, unknown> {
  const abs = (path: string) => new URL(withBase(path), site).href
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    alternateName: 'Jumpman batch photo editor',
    description: HOME_DESCRIPTION,
    applicationCategory: 'MultimediaApplication',
    applicationSubCategory: 'Batch photo editor',
    operatingSystem: 'Web, Android',
    url: abs(''),
    installUrl: abs('app/'),
    downloadUrl: links.releases,
    image: abs('og.png'),
    screenshot: screens.map((s) => abs(s.src)),
    license: 'https://opensource.org/licenses/MIT',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: { '@type': 'Person', name: 'fzn0x', url: 'https://github.com/fzn0x' },
    sameAs: [links.repo],
    keywords:
      'batch photo editor, bulk photo editing, edit multiple photos at once, presets, LUT, Lightroom XMP, open source, offline',
    featureList: featureGroups
      .flatMap((g) => g.features)
      .filter((f) => f.status === 'available')
      .map((f) => f.title),
  }
}
