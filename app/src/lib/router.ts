// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Tiny hash router: static hosting friendly (GitHub Pages, Netlify, Vercel) and keeps the
// challenge hand-off in the URL *fragment*, which browsers never send to any server.

import { useEffect, useState } from 'react';

export type Route = { path: string; params: URLSearchParams };

const parse = (): Route => {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path = '/', query = ''] = raw.split('?');
  return { path, params: new URLSearchParams(query) };
};

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const href = (path: string, params?: Record<string, string>): string =>
  `#${path}${params ? `?${new URLSearchParams(params).toString()}` : ''}`;

export const navigate = (path: string, params?: Record<string, string>): void => {
  window.location.hash = href(path, params).slice(1);
};
