// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory

import './globals';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './state';

const root = document.getElementById('root');
if (!root) throw new Error('AgePass: #root element missing');

createRoot(root).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
