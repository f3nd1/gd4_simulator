import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installCycleLockGuards } from './store/installCycleLock'

// A Locked cycle is the audit record: block the writes before any UI mounts.
installCycleLockGuards()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
