// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory

import { Logo, Toasts } from './components/ui';
import { NETWORK } from './lib/config';
import { href, useRoute } from './lib/router';
import { ExplorerPage } from './pages/Explorer';
import { IssuerPage } from './pages/Issuer';
import { Landing } from './pages/Landing';
import { StorePage } from './pages/Store';
import { TryPage } from './pages/Try';
import { WalletPage } from './pages/Wallet';

const NAV = [
  { path: '/wallet', label: 'Wallet' },
  { path: '/issuer', label: 'Issuer desk' },
  { path: '/store', label: 'Demo store' },
  { path: '/explorer', label: 'Explorer' },
  { path: '/try', label: 'Try without a wallet' },
];

export function App() {
  const route = useRoute();
  const page =
    route.path === '/wallet' ? (
      <WalletPage route={route} />
    ) : route.path === '/issuer' ? (
      <IssuerPage />
    ) : route.path === '/store' ? (
      <StorePage />
    ) : route.path === '/explorer' ? (
      <ExplorerPage />
    ) : route.path === '/try' ? (
      <TryPage />
    ) : (
      <Landing />
    );

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <a className="brand" href={href('/')} aria-label="AgePass home">
          <Logo />
          <span>AgePass</span>
        </a>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <a
              key={n.path}
              href={href(n.path)}
              aria-current={route.path === n.path ? 'page' : undefined}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <span className="netbadge" title="Midnight network">
          {NETWORK}
        </span>
      </header>
      <main id="main" className="container">
        {page}
      </main>
      <footer className="footer">
        <span>
          Built on{' '}
          <a href="https://midnight.network" target="_blank" rel="noreferrer">
            Midnight
          </a>{' '}
          · Apache-2.0 · demo data only
        </span>
      </footer>
      <Toasts />
    </>
  );
}
