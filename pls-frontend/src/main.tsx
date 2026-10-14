import './storage/purgeOnStart'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startOffline } from './offline/start'
import { registerServiceWorker } from './offline/serviceWorker'

startOffline()
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
