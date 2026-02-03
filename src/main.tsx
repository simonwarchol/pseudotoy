import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { fragmentShader } from './CustomShaderExtension'

function encodeShaderForUrl(shader: string): string {
  const bytes = new TextEncoder().encode(shader)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_')
}

// Visiting / with no hash → set hash and reload (replace alone doesn't reload for hash-only changes)
if (!window.location.hash) {
  const encoded = encodeShaderForUrl(fragmentShader)
  window.location.hash = encoded
  window.location.reload()
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
