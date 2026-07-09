import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import '@fontsource/inter/index.css';
import '@fontsource/inter/600.css';
import '@fontsource/anton/index.css';
import '@fontsource/bebas-neue/index.css';
import '@fontsource/archivo-black/index.css';
import '@fontsource/montserrat/index.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/oswald/index.css';
import '@fontsource/bangers/index.css';
import '@fontsource/roboto-condensed/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
