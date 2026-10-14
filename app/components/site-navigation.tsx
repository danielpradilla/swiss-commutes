import InternalLink from 'next/link';

const sections = [
  { id: 'commuting', href: '/', label: 'Commuting' },
  { id: 'traffic', href: '/live/', label: 'Traffic' },
  { id: 'trains', href: '/trains/', label: 'Trains' },
  { id: 'public-transport', href: '/public-transport/', label: 'Public transport' },
  { id: 'mobility', href: '/mobility/', label: 'Shared mobility' },
] as const;

type ActiveSection = 'commuting' | 'traffic' | 'trains' | 'public-transport' | 'mobility';

export default function SiteNavigation({ active }: { active: ActiveSection }) {
  return <>
    {sections.map(({ id, href, label }) => <InternalLink key={id} href={href} aria-current={active === id ? 'page' : undefined}>{label}</InternalLink>)}
    <a href="#sources">Sources & method</a>
    <a href="https://www.danielpradilla.info/blog/">Blog</a>
    <a href="https://github.com/danielpradilla/swiss-commutes">GitHub</a>
  </>;
}
