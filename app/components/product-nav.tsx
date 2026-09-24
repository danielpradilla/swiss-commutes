import Link from 'next/link';

type Product = 'commuting' | 'traffic' | 'trains';

export default function ProductNav({ city, current }: { city: string; current: Product }) {
  const products: { id: Product; label: string; href: string }[] = [
    { id: 'commuting', label: 'A day of commuting', href: `/${city}/` },
    { id: 'traffic', label: 'Traffic', href: `/live/${city}/` },
    { id: 'trains', label: 'Trains', href: `/trains/${city}/` },
  ];

  return <nav className="productNav" aria-label="Swiss Commutes views">
    {products.map(product => <Link key={product.id} href={product.href}
      aria-current={current === product.id ? 'page' : undefined}>{product.label}</Link>)}
  </nav>;
}
